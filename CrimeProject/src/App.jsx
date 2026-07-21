
import { useEffect, useMemo, useState } from "react";
import DistrictChoropleth from "./DistrictChoropleth";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export default function App() {
  const [crimeData, setCrimeData] = useState([]);
  const [geojsonData, setGeojsonData] = useState(null);

  const [selectedYear, setSelectedYear] = useState(2023);
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");

  const [flags, setFlags] = useState({
    women: false,
    children: false,
    oppressedClasses: false,
  });

  const [report, setReport] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [safeCities, setSafeCities] = useState([]);

  const [pieChart, setPieChart] = useState("");
  const [barChart, setBarChart] = useState("");
  const [trendChart, setTrendChart] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const [crimeRes, geoRes] = await Promise.all([
          fetch("/data/crime_data.json"),
          fetch("/data/india_districts.geojson"),
        ]);

        if (!crimeRes.ok) throw new Error("Failed to load crime_data.json");
        if (!geoRes.ok) throw new Error("Failed to load india_districts.geojson");

        const crimeJson = await crimeRes.json();
        const geoJson = await geoRes.json();

        setCrimeData(crimeJson);
        setGeojsonData(geoJson);
      } catch (err) {
        console.error(err);
      }
    }

    loadData();
  }, []);

  const years = useMemo(() => {
    return [...new Set(crimeData.map((d) => Number(d.year)))]
      .filter((y) => !Number.isNaN(y))
      .sort((a, b) => a - b);
  }, [crimeData]);

  const states = useMemo(() => {
    return [...new Set(crimeData.map((d) => d.state))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [crimeData]);

  const districts = useMemo(() => {
    return [
      ...new Set(
        crimeData
          .filter((d) => !selectedState || d.state === selectedState)
          .map((d) => d.district)
      ),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [crimeData, selectedState]);

  function handleStateChange(e) {
    setSelectedState(e.target.value);
    setSelectedDistrict("");
  }

  function handleFlagChange(e) {
    const { name, checked } = e.target;
    setFlags((prev) => ({
      ...prev,
      [name]: checked,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      const res = await fetch(`${API_BASE}/safety`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          district: selectedDistrict,
          is_woman: flags.women,
          is_child: flags.children,
          is_sc: flags.oppressedClasses,
          is_st: false,
        }),
      });

      const data = await res.json();
      setReport(data.report || "No report returned.");
      setPieChart(data.pie_chart || "");
      setBarChart(data.bar_chart || "");
      setTrendChart(data.trend_chart || "");
      setShowPopup(true);
    } catch (error) {
      console.error("Error calling ML API:", error);
      setReport("Failed to fetch report.");
      setPieChart("");
      setBarChart("");
      setTrendChart("");
      setShowPopup(true);
    }
  }

  async function getSafeCities() {
    try {
      const res = await fetch(`${API_BASE}/safe-cities`);
      const data = await res.json();
      setSafeCities(data);
    } catch (error) {
      console.error("Error fetching safe cities:", error);
    }
  }

  async function downloadPdf() {
    try {
      const res = await fetch(`${API_BASE}/safety-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          district: selectedDistrict,
          is_woman: flags.women,
          is_child: flags.children,
          is_sc: flags.oppressedClasses,
          is_st: false,
        }),
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedDistrict || "district"}_safety_report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  }

  function parseSafetyReport(reportText) {
    if (!reportText) return null;

    const lines = reportText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^=+$/.test(line) && !/^-+$/.test(line));

    let title = "";
    let profile = "";
    let score = "";
    let scale = "";
    let summary = "";
    const saferDistricts = [];

    let saferMode = false;

    for (const line of lines) {
      if (line.startsWith("PERSONALIZED SAFETY REPORT FOR:")) {
        title = line.replace("PERSONALIZED SAFETY REPORT FOR:", "").trim();
      } else if (line.startsWith("USER PROFILE:")) {
        profile = line.replace("USER PROFILE:", "").trim();
      } else if (line.startsWith("PREDICTED SAFETY SCORE:")) {
        score = line.replace("PREDICTED SAFETY SCORE:", "").trim();
      } else if (line.startsWith("(Scale:")) {
        scale = line;
      } else if (line === "Consider these safer districts:") {
        saferMode = true;
        summary = line;
      } else if (line === "You are already in one of the safest districts.") {
        summary = line;
      } else if (saferMode) {
        const parts = line.split(/\s{2,}/).filter(Boolean);

        if (parts.length >= 4 && parts[0] !== "District") {
          saferDistricts.push({
            district: parts[0],
            state: parts[1],
            distance: parts[2],
            safetyIndex: parts[3],
          });
        }
      }
    }

    return {
      title,
      profile,
      score,
      scale,
      summary,
      saferDistricts,
    };
  }

  const parsedReport = parseSafetyReport(report);

  return (
    <>
      <div className={`app-shell ${showPopup ? "popup-open" : ""}`}>
        <div className="left-pane">
          <div className="ui-card">
            <div className="ui-header">
              <div className="badge">Crime Reporter</div>
              <h1>District Crime Dashboard</h1>
              <p>Select a state, then a district, then choose the focus groups.</p>
            </div>

            <form className="form-grid" onSubmit={handleSubmit}>

              <div className="field">
                <label htmlFor="state">Select state</label>
                <select
                  id="state"
                  value={selectedState}
                  onChange={handleStateChange}
                >
                  <option value="">All India</option>
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="district">Select district</label>
                <select
                  id="district"
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  disabled={!selectedState}
                >
                  <option value="">
                    {selectedState ? "Select district" : "Select state first"}
                  </option>
                  {districts.map((district) => (
                    <option key={district} value={district}>
                      {district}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Choose category</label>

                <label className="check-card">
                  <input
                    type="checkbox"
                    name="women"
                    checked={flags.women}
                    onChange={handleFlagChange}
                  />
                  <span>Women</span>
                </label>

                <label className="check-card">
                  <input
                    type="checkbox"
                    name="children"
                    checked={flags.children}
                    onChange={handleFlagChange}
                  />
                  <span>Children</span>
                </label>

                <label className="check-card">
                  <input
                    type="checkbox"
                    name="oppressedClasses"
                    checked={flags.oppressedClasses}
                    onChange={handleFlagChange}
                  />
                  <span>Oppressed classes</span>
                </label>
              </div>

              <button type="submit" className="submit-btn">
                Generate Safety Report
              </button>
            </form>

            <button className="submit-btn safe-btn" onClick={getSafeCities}>
              Top 5 Cities for Women & Children
            </button>

            <button className="submit-btn pdf-btn" onClick={downloadPdf}>
              Download PDF Report
            </button>

            <ul className="safe-list">
              {safeCities.map((c, i) => (
                <li key={i}>
                  {c.District} ({c["State/UT"]}) - Risk: {c.Risk}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="right-pane">
          <div className="map-card">
            {geojsonData && crimeData.length > 0 ? (
              <DistrictChoropleth
                geojsonData={geojsonData}
                crimeData={crimeData}
                selectedYear={selectedYear}
                selectedState={selectedState}
                selectedDistrict={selectedDistrict}
              />
            ) : (
              <div className="loading-box">Loading map...</div>
            )}
          </div>
        </div>
      </div>

      {showPopup && (
        <div className="popup-overlay">
          <div className="popup-box">
            <div className="popup-header">
              <h3>Safety Report</h3>
              <button
                className="popup-close"
                onClick={() => setShowPopup(false)}
              >
                ×
              </button>
            </div>

            <div className="popup-content">
              {!parsedReport ? (
                <div className="report-empty">No report available.</div>
              ) : (
                <div className="report-layout">
                  <div className="report-top">
                    <div className="report-title-block">
                      <div className="report-label">District</div>
                      <div className="report-district">
                        {parsedReport.title || selectedDistrict || "Unknown"}
                      </div>
                    </div>

                    <div className="report-score-card">
                      <div className="report-label">Safety Score</div>
                      <div className="report-score-value">
                        {parsedReport.score || "--"}
                      </div>
                      <div className="report-score-subtext">
                        1 = safer, 100 = higher risk
                      </div>
                    </div>
                  </div>

                  <div className="report-grid">
                    <div className="report-info-card">
                      <div className="report-label">User Profile</div>
                      <div className="report-main-text">
                        {parsedReport.profile || "Not specified"}
                      </div>
                    </div>

                    <div className="report-info-card">
                      <div className="report-label">Scale</div>
                      <div className="report-main-text">
                        {parsedReport.scale || "Not available"}
                      </div>
                    </div>
                  </div>

                  <div className="report-summary-card">
                    <div className="report-label">Assessment</div>
                    <div className="report-summary-text">
                      {parsedReport.summary || "No summary available."}
                    </div>
                  </div>

                  {parsedReport.saferDistricts.length > 0 && (
                    <div className="report-table-card">
                      <div className="report-label">Safer Nearby Options</div>

                      <div className="report-table">
                        <div className="report-table-header">
                          <div>District</div>
                          <div>State</div>
                          <div>Distance (km)</div>
                          <div>Safety Index</div>
                        </div>

                        {parsedReport.saferDistricts.map((item, index) => (
                          <div className="report-table-row" key={index}>
                            <div>{item.district}</div>
                            <div>{item.state}</div>
                            <div>{item.distance}</div>
                            <div>{item.safetyIndex}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(pieChart || barChart || trendChart) && (
                    <div className="charts-section">
                      <div className="report-label">Matplotlib Analysis</div>

                      <div className="charts-grid">
                        {pieChart && (
                          <div className="chart-card">
                            <h4>Crime Distribution</h4>
                            <img
                              src={`data:image/png;base64,${pieChart}`}
                              alt="Pie Chart"
                            />
                          </div>
                        )}

                        {barChart && (
                          <div className="chart-card">
                            <h4>Crime Category Comparison</h4>
                            <img
                              src={`data:image/png;base64,${barChart}`}
                              alt="Bar Chart"
                            />
                          </div>
                        )}

                        {trendChart && (
                          <div className="chart-card chart-card-wide">
                            <h4>Crime Trend Over Years</h4>
                            <img
                              src={`data:image/png;base64,${trendChart}`}
                              alt="Trend Chart"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="popup-footer">
              <button className="submit-btn pdf-btn" onClick={downloadPdf}>
                Download PDF
              </button>
              <button
                className="submit-btn"
                onClick={() => setShowPopup(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}