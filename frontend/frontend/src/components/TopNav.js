function TopNav({ tabs, activeTab, onChange }) {
  return (
    <nav className="top-nav" aria-label="Primary navigation">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export default TopNav;
