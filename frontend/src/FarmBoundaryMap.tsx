import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import type { FarmBoundaryPoint } from "./api";

interface Props {
  points: FarmBoundaryPoint[];
  onChange: (points: FarmBoundaryPoint[]) => void;
}

export default function FarmBoundaryMap({ points, onChange }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const [locationError, setLocationError] = useState("");

  pointsRef.current = points;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!mapElement.current) return;
    const instance = L.map(mapElement.current).setView([-0.5, 37], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    const layerGroup = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (pointsRef.current.length >= 100) {
        setLocationError("A boundary can contain at most 100 points.");
        return;
      }
      onChangeRef.current([
        ...pointsRef.current,
        { latitude: event.latlng.lat, longitude: event.latlng.lng },
      ]);
      setLocationError("");
    });
    map.current = instance;
    layers.current = layerGroup;
    return () => {
      instance.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  useEffect(() => {
    const layerGroup = layers.current;
    if (!layerGroup) return;
    layerGroup.clearLayers();
    const latLngs = points.map((point) => L.latLng(point.latitude, point.longitude));
    for (const point of latLngs) {
      L.circleMarker(point, {
        radius: 5,
        color: "#14532d",
        fillColor: "#22c55e",
        fillOpacity: 0.9,
      }).addTo(layerGroup);
    }
    if (latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: "#14532d",
        fillColor: "#22c55e",
        fillOpacity: 0.2,
      }).addTo(layerGroup);
    } else if (latLngs.length === 2) {
      L.polyline(latLngs, { color: "#14532d" }).addTo(layerGroup);
    }
  }, [points]);

  const locateFarm = () => {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("This device does not support GPS location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.current?.setView(
          [position.coords.latitude, position.coords.longitude],
          17,
        );
      },
      (error) => {
        setLocationError(`Could not get GPS location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  return (
    <div className="farm-boundary-editor">
      <p className="mut">
        Use “Locate farm” to center the map, then tap/click at least 3 points
        around the farm boundary. OpenStreetMap receives map-tile requests for
        the area you view.
      </p>
      <div className="admin-actions">
        <button className="btn" type="button" onClick={locateFarm}>
          Locate farm with GPS
        </button>
        <button
          className="btn"
          type="button"
          disabled={!points.length}
          onClick={() => {
            onChange([]);
            setLocationError("");
          }}
        >
          Clear boundary
        </button>
        <span className="mut">{points.length} boundary points</span>
      </div>
      <div
        className="farm-boundary-map"
        ref={mapElement}
        aria-label="Interactive map to draw farm boundary"
      />
      {locationError && <p className="notice error">{locationError}</p>}
    </div>
  );
}
