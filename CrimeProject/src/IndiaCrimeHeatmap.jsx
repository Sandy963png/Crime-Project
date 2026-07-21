import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

function HeatLayer({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points || points.length === 0) return;

    const heatPoints = points.map(p => [
      p.latitude,
      p.longitude,
      p.crime_norm
    ]);

    const heat = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 20,
      maxZoom: 7,
      gradient: {
        0.0: "green",
        0.4: "yellow",
        0.7: "orange",
        1.0: "red"
      }
    });

    heat.addTo(map);

    return () => {
      map.removeLayer(heat);
    };
  }, [points]);

  return null;
}

export default function CrimeHeatMap({ data }) {
  return (
    <MapContainer
      center={[22.9734, 78.6569]}  // India center
      zoom={5}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <HeatLayer points={data} />
    </MapContainer>
  );
}