import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import { useMemo, useEffect } from "react";
import * as turf from "@turf/turf";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stateAliases = {
  "a and n islands": "andaman and nicobar islands",
  "andaman and nicobar islands": "andaman and nicobar islands",
  "nct of delhi": "delhi",
  "orissa": "odisha",
  "uttaranchal": "uttarakhand",
  "pondicherry": "puducherry",
  "jammu and kashmir": "jammu",
};

const districtAliases = {
  "north and middle andaman": "north middle andaman",
  "north middle andaman": "north middle andaman",
  "bangalore urban": "bengaluru urban",
  "bangalore rural": "bangalore",
  "anantapuramu": "anantapur",
  "chikkaballapura": "chikballapur",
  "chamarajanagara": "chamarajanagar",
  "mysore": "mysuru",
  "mysore city": "mysuru",
  "mysuru city": "mysuru",
  "gurugram": "gurgaon",
  "sri potti sriramulu nellore": "nellore",
  "dr br ambedkar konaseema": "konaseema",
  "ysr": "ysr kadapa",
  "kadapa": "ysr kadapa",
  "cuddapah": "ysr kadapa",
};

const ignoredDistricts = ["railway", "commissionerate"];

function applyAlias(value, aliasMap) {
  const key = normalize(value);
  return aliasMap[key] || key;
}

function shouldIgnoreDistrict(name) {
  const district = normalize(name);
  return ignoredDistricts.some((bad) => district.includes(bad));
}

function getStateName(props) {
  return (
    props.state ||
    props.STATE ||
    props.STATE_NAME ||
    props.st_nm ||
    props.ST_NM ||
    props.NAME_1 ||
    ""
  );
}

function getDistrictName(props) {
  return (
    props.district ||
    props.DISTRICT ||
    props.DIST_NAME ||
    props.dtname ||
    props.DTNAME ||
    props.NAME_2 ||
    props.dist_name ||
    ""
  );
}

function getColor(v) {
  return v > 0.8 ? "#7f0000"
    : v > 0.6 ? "#b30000"
    : v > 0.4 ? "#d7301f"
    : v > 0.2 ? "#ef6548"
    : v > 0.1 ? "#fc8d59"
    : v > 0.05 ? "#fdbb84"
    : "#fee8c8";
}

function getBestCrimeRows(crimeData, selectedYear, selectedState) {
  const minYear = 2017;
  const maxYear = Number(selectedYear);
  const byDistrict = new Map();

  for (const row of crimeData) {
    const year = Number(row.year);
    if (Number.isNaN(year) || year < minYear || year > maxYear) continue;
    if (selectedState && row.state !== selectedState) continue;
    if (shouldIgnoreDistrict(row.district)) continue;
    if (row.latitude == null || row.longitude == null) continue;

    const stateKey = applyAlias(row.state, stateAliases);
    const districtKey = applyAlias(row.district, districtAliases);
    const key = `${stateKey}|${districtKey}`;

    const prev = byDistrict.get(key);
    if (!prev || year > prev.year) {
      byDistrict.set(key, {
        ...row,
        year,
        stateKey,
        districtKey,
      });
    }
  }

  return Array.from(byDistrict.values());
}

function ZoomController({ joinedData, selectedState, selectedDistrict }) {
  const map = useMap();

  useEffect(() => {
    if (!joinedData || !joinedData.features?.length) return;

    if (selectedDistrict && selectedState) {
      const stateKey = applyAlias(selectedState, stateAliases);
      const districtKey = applyAlias(selectedDistrict, districtAliases);

      const districtFeatures = joinedData.features.filter((feature) => {
        const props = feature.properties || {};
        const fState = applyAlias(getStateName(props), stateAliases);
        const fDistrict = applyAlias(getDistrictName(props), districtAliases);
        return fState === stateKey && fDistrict === districtKey;
      });

      if (districtFeatures.length > 0) {
        const layer = L.geoJSON({
          type: "FeatureCollection",
          features: districtFeatures,
        });
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
          return;
        }
      }
    }

    if (selectedState) {
      const stateKey = applyAlias(selectedState, stateAliases);

      const stateFeatures = joinedData.features.filter((feature) => {
        const props = feature.properties || {};
        const fState = applyAlias(getStateName(props), stateAliases);
        return fState === stateKey;
      });

      if (stateFeatures.length > 0) {
        const layer = L.geoJSON({
          type: "FeatureCollection",
          features: stateFeatures,
        });
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
          return;
        }
      }
    }

    map.setView([22.9734, 78.6569], 5);
  }, [joinedData, selectedState, selectedDistrict, map]);

  return null;
}

export default function DistrictChoropleth({
  geojsonData,
  crimeData,
  selectedYear,
  selectedState,
  selectedDistrict,
}) {
  const joinedData = useMemo(() => {
    if (!geojsonData || !geojsonData.features || !crimeData?.length) return null;

    const bestRows = getBestCrimeRows(crimeData, selectedYear, selectedState);

    const features = geojsonData.features.map((feature, index) => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        _featureIndex: index,
        joined_state: getStateName(feature.properties || {}),
        joined_district: getDistrictName(feature.properties || {}),
        crime_norm: null,
        source_year: null,
        source_method: null,
      },
    }));

    const assignedFeatureIndexes = new Set();
    const unmatchedRows = [];

    for (const row of bestRows) {
      const pt = turf.point([Number(row.longitude), Number(row.latitude)]);
      let matchedIndex = -1;

      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        try {
          if (turf.booleanPointInPolygon(pt, feature)) {
            matchedIndex = i;
            break;
          }
        } catch {
          // skip invalid geometry
        }
      }

      if (matchedIndex !== -1) {
        const f = features[matchedIndex];
        f.properties.crime_norm = Number(row.crime_norm || 0);
        f.properties.source_year = Number(row.year);
        f.properties.source_method = "spatial";
        f.properties.data_state = row.state;
        f.properties.data_district = row.district;
        assignedFeatureIndexes.add(matchedIndex);
      } else {
        unmatchedRows.push(row);
      }
    }

    const nameLookup = new Map();
    for (const row of unmatchedRows) {
      const key = `${row.stateKey}|${row.districtKey}`;
      nameLookup.set(key, row);
    }

    for (let i = 0; i < features.length; i++) {
      if (assignedFeatureIndexes.has(i)) continue;

      const props = features[i].properties || {};
      const stateKey = applyAlias(getStateName(props), stateAliases);
      const districtKey = applyAlias(getDistrictName(props), districtAliases);
      const key = `${stateKey}|${districtKey}`;

      const row = nameLookup.get(key);
      if (row) {
        props.crime_norm = Number(row.crime_norm || 0);
        props.source_year = Number(row.year);
        props.source_method = "name";
        props.data_state = row.state;
        props.data_district = row.district;
      }
    }

    return {
      type: "FeatureCollection",
      features,
    };
  }, [geojsonData, crimeData, selectedYear, selectedState]);

  return (
    <div className="map-wrapper">
      <MapContainer
        center={[22.9734, 78.6569]}
        zoom={5}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomController
          joinedData={joinedData}
          selectedState={selectedState}
          selectedDistrict={selectedDistrict}
        />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {joinedData && (
          <GeoJSON
            data={joinedData}
            style={(feature) => {
              const value = feature.properties.crime_norm;
              return {
                fillColor: value == null ? "#d1d5db" : getColor(value),
                weight: 0.5,
                color: "#ffffff",
                fillOpacity: 0.85,
              };
            }}
            onEachFeature={(feature, layer) => {
              const props = feature.properties || {};
              const district = props.joined_district || "Unknown District";
              const state = props.joined_state || "Unknown State";
              const value = props.crime_norm;
              const sourceYear = props.source_year;

              layer.bindTooltip(
                `
                <div style="font-size:14px; line-height:1.4;">
                  <strong>${district}</strong><br/>
                  ${state}<br/>
                  crime_norm: ${value == null ? "No data" : Number(value).toFixed(4)}<br/>
                  source year: ${sourceYear == null ? "No data" : sourceYear}
                </div>
                `,
                { sticky: true }
              );
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}