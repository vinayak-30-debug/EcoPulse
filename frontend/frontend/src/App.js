import { useMemo, useState } from "react";

import "./App.css";
import TopNav from "./components/TopNav";
import {
  DEFAULT_ANALYZE_INPUTS,
  DEFAULT_HOUSEHOLD_SIZE,
  DEFAULT_RECYCLING_SCORE,
  TABS,
} from "./constants";
import DashboardPage from "./pages/DashboardPage";
import AnalyzePage from "./pages/AnalyzePage";
import EstimatorPage from "./pages/EstimatorPage";
import InsightsPage from "./pages/InsightsPage";
import MonthlyReportPage from "./pages/MonthlyReportPage";
import AboutPage from "./pages/AboutPage";
import LoginPage from "./pages/LoginPage";
import { extractBillValue, predictSustainability } from "./services/api";
import {
  clearAuthSession,
  createAuthSession,
  loadAuthSession,
  persistAuthSession,
  requestSignupCode,
  verifySignupCode,
} from "./services/auth";
import {
  calculateHeuristicScore,
  getContextAwareStatus,
} from "./utils/scoring";
import { clampAnalyzeValue, normalizeAnalyzeInputs } from "./utils/inputLimits";
import {
  clampHouseholdSize,
  getAverageValuesForHousehold,
} from "./utils/householdAverages";
import { simulateWhatIfResults } from "./utils/whatIf";

function App() {
  const [authSession, setAuthSession] = useState(() => loadAuthSession());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [signupNotice, setSignupNotice] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [analyzeInputs, setAnalyzeInputs] = useState(DEFAULT_ANALYZE_INPUTS);
  const [householdSize, setHouseholdSize] = useState(DEFAULT_HOUSEHOLD_SIZE);
  const [prediction, setPrediction] = useState(null);
  const [whatIfResults, setWhatIfResults] = useState([]);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfError, setWhatIfError] = useState("");
  const [billUploadLoading, setBillUploadLoading] = useState({
    electricity: false,
    water: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prefillNotice, setPrefillNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const dashboardScore = prediction?.score ?? calculateHeuristicScore(analyzeInputs);
  const averageValues = useMemo(
    () => getAverageValuesForHousehold(householdSize),
    [householdSize]
  );
  const dashboardStatus = getContextAwareStatus(
    dashboardScore,
    analyzeInputs,
    averageValues
  );

  const summary = useMemo(
    () => ({
      score: dashboardScore,
      status: dashboardStatus,
      hasPrediction: Boolean(prediction),
    }),
    [dashboardScore, dashboardStatus, prediction]
  );

  const handleAnalyzeInputChange = (key, value) => {
    setAnalyzeInputs((prev) => ({
      ...prev,
      [key]: clampAnalyzeValue(key, Number(value)),
    }));
  };

  const handleLogin = async (credentials) => {
    setAuthLoading(true);
    setAuthError("");
    setSignupNotice("");

    try {
      const session = await createAuthSession(credentials);
      persistAuthSession(session);
      setAuthSession(session);
    } catch (err) {
      setAuthError(err.message || "Unable to sign in right now.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignupRequestCode = async (email) => {
    setAuthLoading(true);
    setAuthError("");
    setSignupNotice("");

    try {
      const response = await requestSignupCode(email);
      if (typeof response?.message === "string") {
        let noticeText = response.message;
        if (response?.verification_code) {
          noticeText = `${noticeText} Code: ${response.verification_code}`;
        }
        setSignupNotice(noticeText);
      }
      return response;
    } catch (err) {
      setAuthError(err.message || "Unable to send verification code right now.");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignupVerifyCode = async ({ email, code }) => {
    setAuthLoading(true);
    setAuthError("");
    setSignupNotice("");

    try {
      const session = await verifySignupCode({ email, code });
      persistAuthSession(session);
      setAuthSession(session);
      return session;
    } catch (err) {
      setAuthError(err.message || "Unable to verify signup code right now.");
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthSession();
    setAuthSession(null);
    setAuthError("");
    setSignupNotice("");
    setActiveTab("dashboard");
    setAnalyzeInputs(DEFAULT_ANALYZE_INPUTS);
    setHouseholdSize(DEFAULT_HOUSEHOLD_SIZE);
    setPrediction(null);
    setWhatIfResults([]);
    setWhatIfError("");
    setError("");
    setPrefillNotice("");
    setLastUpdated(null);
  };

  const handleAnalyzeSubmit = async () => {
    setLoading(true);
    setError("");
    setWhatIfError("");
    setWhatIfResults([]);

    const payload = normalizeAnalyzeInputs({
      ...analyzeInputs,
      recycling: analyzeInputs.recycling ?? DEFAULT_RECYCLING_SCORE,
    });
    payload.household_size = householdSize;

    try {
      const result = await predictSustainability(payload);
      setPrediction(result);

      setWhatIfLoading(true);
      const simulated = simulateWhatIfResults(payload, Number(result.score));
      if (simulated.length > 0) {
        setWhatIfResults(simulated);
      } else {
        setWhatIfError("What-if simulation is unavailable right now.");
      }

      setLastUpdated(new Date());
      setPrefillNotice("");
    } catch (err) {
      setPrediction(null);
      setError(err.message || "Unable to connect to backend API.");
      setWhatIfResults([]);
      setWhatIfError("");
    } finally {
      setWhatIfLoading(false);
      setLoading(false);
    }
  };

  const handleBillUpload = async (field, file) => {
    if (!file || !["electricity", "water"].includes(field)) {
      return;
    }

    setBillUploadLoading((prev) => ({ ...prev, [field]: true }));
    setError("");

    try {
      const result = await extractBillValue(file, field);
      const extractedDailyValue = clampAnalyzeValue(field, Number(result.daily_value));
      const unit = field === "electricity" ? "kWh/day" : "liters/day";

      setAnalyzeInputs((prev) => ({
        ...prev,
        [field]: extractedDailyValue,
      }));

      setPrefillNotice(
        `${field === "electricity" ? "Electricity" : "Water"} bill scanned: ${extractedDailyValue} ${unit} extracted from ${result.raw_value} ${result.raw_unit} over ${result.billing_days} days.`
      );
    } catch (err) {
      setError(err.message || "Could not extract values from uploaded bill.");
    } finally {
      setBillUploadLoading((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleEstimatorApply = (estimatePayload) => {
    const estimatedInputs = estimatePayload?.inputs ?? estimatePayload;
    const nextHouseholdSize = clampHouseholdSize(
      estimatePayload?.people ?? householdSize
    );

    const normalized = normalizeAnalyzeInputs({
      ...analyzeInputs,
      ...estimatedInputs,
    });

    setHouseholdSize(nextHouseholdSize);
    setAnalyzeInputs(normalized);
    setActiveTab("analyze");
    setPrefillNotice(
      `Estimator values applied for ${nextHouseholdSize} people: ${normalized.electricity} kWh electricity, ${normalized.water} L water, ${normalized.waste} kg waste.`
    );
  };

  const renderPage = () => {
    if (activeTab === "dashboard") {
      return (
        <DashboardPage
          score={summary.score}
          status={summary.status}
          inputs={analyzeInputs}
          averageValues={averageValues}
          hasPrediction={summary.hasPrediction}
          onNavigate={setActiveTab}
        />
      );
    }

    if (activeTab === "analyze") {
      return (
        <AnalyzePage
          inputs={analyzeInputs}
          prediction={prediction}
          householdSize={householdSize}
          averageValues={averageValues}
          whatIfResults={whatIfResults}
          whatIfLoading={whatIfLoading}
          whatIfError={whatIfError}
          billUploadLoading={billUploadLoading}
          loading={loading}
          error={error}
          notice={prefillNotice}
          lastUpdated={lastUpdated}
          onInputChange={handleAnalyzeInputChange}
          onHouseholdSizeChange={setHouseholdSize}
          onBillUpload={handleBillUpload}
          onSubmit={handleAnalyzeSubmit}
        />
      );
    }

    if (activeTab === "estimator") {
      return <EstimatorPage onApplyEstimate={handleEstimatorApply} />;
    }

    if (activeTab === "monthly-report") {
      return (
        <MonthlyReportPage
          initialInputs={analyzeInputs}
          initialHouseholdSize={householdSize}
        />
      );
    }

    if (activeTab === "insights") {
      return (
        <InsightsPage
          inputs={analyzeInputs}
          householdSize={householdSize}
          averageValues={averageValues}
          prediction={prediction}
          score={summary.score}
          status={summary.status}
        />
      );
    }

    return <AboutPage />;
  };

  if (!authSession) {
    return (
      <div className="app-shell">
        <div className="ambient-bg" aria-hidden="true" />
        <LoginPage
          onLogin={handleLogin}
          onSignupRequestCode={handleSignupRequestCode}
          onSignupVerifyCode={handleSignupVerifyCode}
          loading={authLoading}
          error={authError}
          signupNotice={signupNotice}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient-bg" aria-hidden="true" />
      <header className="app-header">
        <div>
          <p className="header-tag">Smart Sustainability Platform</p>
          <h1>EcoPulse Home</h1>
          <p className="header-subtitle">
            Monitor usage, run ML analysis, and plan practical improvements for
            a greener household.
          </p>
        </div>

        <div className="header-user-panel">
          <p className="header-user-label">Signed in as</p>
          <strong>{authSession.name}</strong>
          <span>{authSession.email}</span>
          <button type="button" className="ghost-btn" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <TopNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <main className="app-main">{renderPage()}</main>
    </div>
  );
}

export default App;
