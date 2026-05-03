function AboutPage() {
  return (
    <section className="about-layout">
      <article className="card">
        <h2>About This Project</h2>
        <p>
          EcoPulse Home is a sustainability assistant for households. It helps
          families track electricity, water, and waste habits and understand how
          those habits affect an overall sustainability score.
        </p>
        <p>
          The scoring engine uses a machine learning model trained on household
          usage patterns. You can run analysis from your own input data and get
          practical, easy-to-follow suggestions for improvement.
        </p>
      </article>

      <article className="card">
        <h3>Why it matters</h3>
        <ul className="simple-list">
          <li>Turns daily consumption into a clear 0-100 score.</li>
          <li>Highlights where usage is above normal household averages.</li>
          <li>Suggests realistic actions for better sustainability outcomes.</li>
          <li>Combines ML intelligence with simple product-style UX.</li>
        </ul>
      </article>
    </section>
  );
}

export default AboutPage;
