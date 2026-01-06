import { useEffect, useMemo, useRef, useState } from "react";
import embed from "vega-embed";
import "./styles.css";

// ---- files in /public
const WAGES_URL = "/fifa_clean.csv";
const COEF_URL = "/model_coefficients.json";

// ---- modeling + display settings
// If your SAS model target was log_wage, keep true so we exp() back to wage.
const TARGET_IS_LOG = true;
// Simple EUR→USD factor. Adjust if you prefer a different rate.
const USD_PER_EUR = 1.08;

/* ---- tiny vega-lite wrapper (no react-vega version issues) ---- */
function Chart({ spec }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    embed(ref.current, spec, { actions: false }).catch(console.error);
  }, [spec]);
  return <div ref={ref} />;
}

/* ---- helpers ---- */
function useCoefficients() {
  const [coefs, setCoefs] = useState({});
  useEffect(() => {
    fetch(COEF_URL)
      .then((r) => r.json())
      .then((arr) => {
        const m = {};
        arr.forEach((d) => (m[d.term] = +d.estimate));
        setCoefs(m);
      });
  }, []);
  return coefs;
}

function fmtUSD(x) {
  if (!isFinite(x)) return "—";
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/* ---- app ---- */
export default function App() {
  // histogram filter
  const [posFilter, setPosFilter] = useState("All");
  // predictor inputs
  const [age, setAge] = useState(24);
  const [rating, setRating] = useState(85); // FIFA rating
  const [foot, setFoot] = useState("Right");
  const [pg, setPg] = useState("Midfielder"); // position group in predictor

  const coefs = useCoefficients();

  // η = β0 + β_age*age + β_rating*rating + β_pos(pg) + β_foot
  // If TARGET_IS_LOG true, convert back with exp() to wage in EUR, then to USD.
  const predictedUSD = useMemo(() => {
    let eta = 0;
    eta += coefs["Intercept"] || 0;
    eta += (coefs["age"] || 0) * Number(age);
    eta += (coefs["overall_rating"] || 0) * Number(rating);
    eta += coefs[`position_group_${pg}`] || 0;
    eta += coefs[`preferred_foot_${foot}`] || 0;

    const wageEur = TARGET_IS_LOG ? Math.exp(eta) : eta;
    return wageEur * USD_PER_EUR;
  }, [coefs, age, rating, pg, foot]);

  // derive position group from positions string for charts
  const calcGroupExpr =
    "indexof(datum.positions,'GK')>=0 ? 'Goalkeeper' :" +
    " (indexof(datum.positions,'CB')>=0 || indexof(datum.positions,'LB')>=0 || indexof(datum.positions,'RB')>=0 || " +
    "   indexof(datum.positions,'RWB')>=0 || indexof(datum.positions,'LWB')>=0) ? 'Defender' :" +
    " (indexof(datum.positions,'CM')>=0 || indexof(datum.positions,'CDM')>=0 || indexof(datum.positions,'CAM')>=0 || " +
    "   indexof(datum.positions,'RM')>=0 || indexof(datum.positions,'LM')>=0 || indexof(datum.positions,'RW')>=0 || " +
    "   indexof(datum.positions,'LW')>=0) ? 'Midfielder' : 'Forward'";

  /* ---- histogram (USD) ---- */
  const wageHistSpec = useMemo(() => {
    const filterExpr =
      posFilter === "All" ? "true" : `datum.group == '${posFilter}'`;
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { url: WAGES_URL },
      transform: [
        { calculate: calcGroupExpr, as: "group" },
        { calculate: `${USD_PER_EUR} * datum.wage_euro`, as: "wage_usd" },
        { filter: filterExpr },
      ],
      mark: "bar",
      encoding: {
        x: {
          field: "wage_usd", // change to your numeric wage field if needed
          type: "quantitative",
          bin: { maxbins: 30 },
          title: "Wage (USD)",
          axis: { format: "$,.0f" },
        },
        y: { aggregate: "count", title: "Players" },
        tooltip: [{ aggregate: "count", title: "Players" }],
      },
      width: "container",
      height: 280,
    };
  }, [posFilter]);

  /* ---- coefficients bar ---- */
  const coefSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: { url: COEF_URL },
    layer: [
      { mark: { type: "bar" } },
      { mark: { type: "rule", color: "#666" }, encoding: { x: { datum: 0 } } },
    ],
    encoding: {
      x: { field: "estimate", type: "quantitative", title: "β" },
      y: { field: "term", type: "nominal", sort: "-x", title: null },
    },
    width: 520,
    height: 320,
  };

  /* ---- boxplot by position group (USD) ---- */
  const boxSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: { url: WAGES_URL },
    transform: [
      { calculate: calcGroupExpr, as: "group" },
      { calculate: `${USD_PER_EUR} * datum.wage_euro`, as: "wage_usd" },
    ],
    mark: { type: "boxplot", extent: "min-max" },
    encoding: {
      x: { field: "group", type: "nominal", title: "Position group" },
      y: {
        field: "wage_usd",
        type: "quantitative",
        title: "Wage (USD)",
        axis: { format: "$,.0f" },
      },
    },
    width: "container",
    height: 320,
  };

  return (
    <main className="wrap">
      <header>
        <h1>FIFA wage model</h1>
        <p className="dek">
          distribution coefficients predictor from age FIFA rating position and
          foot values in USD
        </p>
      </header>

      <section className="card">
        <h2>distribution of wages</h2>
        <div className="controls">
          <label>
            position group filter
            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
            >
              <option>All</option>
              <option>Defender</option>
              <option>Midfielder</option>
              <option>Forward</option>
              <option>Goalkeeper</option>
            </select>
          </label>
        </div>
        <Chart spec={wageHistSpec} />
        <p className="caption">
          derived from positions string hover for counts
        </p>
      </section>

      <section className="card">
        <h2>model coefficients</h2>
        <Chart spec={coefSpec} />
        <p className="caption">
          bars right of zero raise predicted wage left lower it
        </p>
      </section>

      <section className="card">
        <h2>predict a wage</h2>
        <div className="grid">
          <label>
            age
            <input
              type="number"
              min="16"
              max="45"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>
          <label>
            FIFA rating
            <input
              type="number"
              min="40"
              max="99"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            />
          </label>
          <label>
            position group
            <select value={pg} onChange={(e) => setPg(e.target.value)}>
              <option>Defender</option>
              <option>Midfielder</option>
              <option>Forward</option>
              <option>Goalkeeper</option>
            </select>
          </label>
          <label>
            preferred foot
            <select value={foot} onChange={(e) => setFoot(e.target.value)}>
              <option>Right</option>
              <option>Left</option>
            </select>
          </label>
        </div>
        <div className="pred">
          <span>predicted wage</span>
          <strong>{fmtUSD(predictedUSD)}</strong>
        </div>
        <p className="caption">
          {TARGET_IS_LOG
            ? "model target was log wage  converted with exp then to USD"
            : "model target was wage  shown in USD"}
        </p>
      </section>

      <section className="card">
        <h2>wage distribution by position boxplot</h2>
        <Chart spec={boxSpec} />
        <p className="caption">
          box shows median and quartiles with whiskers min to max
        </p>
      </section>

      <footer className="foot">
        <p>
          baseline terms come from your SAS coding; edit the JSON keys or the
          compute step if names differ
        </p>
      </footer>
    </main>
  );
}
