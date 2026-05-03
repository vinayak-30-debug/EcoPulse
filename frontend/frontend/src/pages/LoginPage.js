import { useState } from "react";

function LoginPage({
  onLogin,
  onSignupRequestCode,
  onSignupVerifyCode,
  loading,
  error,
  signupNotice,
}) {
  const [credentials, setCredentials] = useState({
    email: "",
    password: "",
  });
  const [signupDetails, setSignupDetails] = useState({
    email: "",
    code: "",
  });
  const [signinClientError, setSigninClientError] = useState("");
  const [signupClientError, setSignupClientError] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);

  const handleFieldChange = (field, value) => {
    setCredentials((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSignupFieldChange = (field, value) => {
    setSignupDetails((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const email = credentials.email.trim();
    const password = credentials.password;

    if (!email || !password) {
      setSigninClientError("Please fill in both email and password.");
      return;
    }

    setSigninClientError("");
    setSignupClientError("");
    await onLogin({ email, password });
  };

  const handleSignupCodeRequest = async (event) => {
    event.preventDefault();
    const email = signupDetails.email.trim();
    if (!email) {
      setSignupClientError("Please enter your email to sign up.");
      return;
    }

    setSigninClientError("");
    setSignupClientError("");

    try {
      const response = await onSignupRequestCode(email);
      setCodeRequested(true);
      if (response?.verification_code) {
        setSignupDetails((prev) => ({
          ...prev,
          code: String(response.verification_code),
        }));
      }
    } catch {
      // Server-side error is displayed via `error` prop.
    }
  };

  const handleSignupVerify = async (event) => {
    event.preventDefault();
    const email = signupDetails.email.trim();
    const code = signupDetails.code.trim();

    if (!email || !code) {
      setSignupClientError("Please enter both your email and confirmation code.");
      return;
    }

    setSigninClientError("");
    setSignupClientError("");

    try {
      await onSignupVerifyCode({ email, code });
    } catch {
      // Server-side error is displayed via `error` prop.
    }
  };

  const visibleError = signinClientError || signupClientError || error;

  return (
    <main className="auth-main">
      <section className="auth-card">
        <p className="header-tag">Secure Access</p>
        <h1>Welcome back to EcoPulse Home</h1>
        <p className="header-subtitle">
          Sign in to access your sustainability dashboard and keep usage insights
          associated with your account.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="input-field" htmlFor="auth-email">
            Email address
            <input
              id="auth-email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={credentials.email}
              onChange={(event) => handleFieldChange("email", event.target.value)}
            />
          </label>

          <label className="input-field" htmlFor="auth-password">
            Password
            <input
              id="auth-password"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={credentials.password}
              onChange={(event) => handleFieldChange("password", event.target.value)}
            />
          </label>

          <button className="primary-btn full-width" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="auth-separator" aria-hidden="true" />

        <section className="auth-subsection" aria-labelledby="signup-heading">
          <h2 id="signup-heading">Sign up</h2>
          <p className="auth-note">
            Enter your email and we will send a confirmation code for verification.
          </p>

          <form className="auth-form" onSubmit={handleSignupCodeRequest}>
            <label className="input-field" htmlFor="signup-email">
              Sign up email
              <input
                id="signup-email"
                type="email"
                name="signup-email"
                autoComplete="email"
                placeholder="you@example.com"
                value={signupDetails.email}
                onChange={(event) => handleSignupFieldChange("email", event.target.value)}
              />
            </label>

            <button className="ghost-btn full-width" type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send confirmation code"}
            </button>
          </form>

          {codeRequested ? (
            <form className="auth-form" onSubmit={handleSignupVerify}>
              <label className="input-field" htmlFor="signup-code">
                Confirmation code
                <input
                  id="signup-code"
                  type="text"
                  name="signup-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={signupDetails.code}
                  onChange={(event) => handleSignupFieldChange("code", event.target.value)}
                />
              </label>

              <button className="primary-btn full-width" type="submit" disabled={loading}>
                {loading ? "Verifying..." : "Verify and sign up"}
              </button>
            </form>
          ) : null}
        </section>

        {visibleError ? (
          <p className="error-text auth-error" role="alert">
            {visibleError}
          </p>
        ) : null}

        {signupNotice ? <p className="notice auth-success">{signupNotice}</p> : null}

        <p className="auth-note">Sign in still supports local demo mode by default.</p>
      </section>
    </main>
  );
}

export default LoginPage;
