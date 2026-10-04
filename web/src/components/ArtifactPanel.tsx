"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import ChartArtifact from "./artifacts/ChartArtifact";
import TableArtifact from "./artifacts/TableArtifact";
import StatsArtifact from "./artifacts/StatsArtifact";
import PropertyCard from "./artifacts/PropertyCard";
import PropertyBreakdown from "./artifacts/PropertyBreakdown";
import DwellingBreakdown from "./artifacts/DwellingBreakdown";

interface Artifact {
  id: string;
  type: "map" | "pie_chart" | "bar_chart" | "table" | "stats" | "property_card" | "property_breakdown" | "dwelling_breakdown" | "dwelling_map";
  title: string;
  data: unknown;
  timestamp: number;
}

// Dynamic import for MapArtifact to avoid SSR issues with Leaflet
const MapArtifact = dynamic(() => import("./artifacts/MapArtifact"), {
  ssr: false,
  loading: () => (
    <div className="h-96 rounded-lg bg-gray-100 flex items-center justify-center">
      <span className="text-gray-500">Loading map...</span>
    </div>
  ),
});

interface ArtifactPanelProps {
  artifacts: Artifact[];
  onAddArtifact: (artifact: Omit<Artifact, "id" | "timestamp">) => void;
}

export default function ArtifactPanel({ artifacts, onAddArtifact }: ArtifactPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Auto-advance to latest artifact when new ones are added
  useEffect(() => {
    if (artifacts.length > 0) {
      setCurrentIndex(artifacts.length - 1);
    }
  }, [artifacts.length]);

  const current = artifacts[currentIndex];

  const goToPrevious = () => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const goToNext = () => {
    setCurrentIndex((i) => Math.min(artifacts.length - 1, i + 1));
  };

  const renderArtifact = (artifact: Artifact) => {
    switch (artifact.type) {
      case "map":
      case "dwelling_map":
        return <MapArtifact data={artifact.data} isDwellingMap={artifact.type === "dwelling_map"} />;
      case "pie_chart":
      case "bar_chart":
        return <ChartArtifact type={artifact.type} data={artifact.data} />;
      case "table":
        return <TableArtifact data={artifact.data} />;
      case "stats":
        return <StatsArtifact data={artifact.data} />;
      case "property_card":
        return <PropertyCard data={artifact.data} />;
      case "property_breakdown":
        return <PropertyBreakdown data={artifact.data} />;
      case "dwelling_breakdown":
        return <DwellingBreakdown data={artifact.data} />;
      default:
        return (
          <div className="p-4 text-gray-500">
            Unknown artifact type: {artifact.type}
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with carousel navigation */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-800">Visualizations</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={goToPrevious}
            disabled={currentIndex === 0 || artifacts.length === 0}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous artifact"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm text-gray-500 min-w-[60px] text-center">
            {artifacts.length > 0 ? `${currentIndex + 1} / ${artifacts.length}` : "No items"}
          </span>
          <button
            onClick={goToNext}
            disabled={currentIndex === artifacts.length - 1 || artifacts.length === 0}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next artifact"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Artifact content */}
      <div className="flex-1 p-6 overflow-auto">
        {!current ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-lg font-medium">No visualizations yet</p>
            <p className="text-sm mt-1">Ask a question to generate charts and maps</p>
          </div>
        ) : (
          <div className="h-full">
            {current.title && (
              <h3 className="text-lg font-medium text-gray-700 mb-4">{current.title}</h3>
            )}
            {renderArtifact(current)}
          </div>
        )}
      </div>

      {/* Thumbnail strip for quick navigation */}
      {artifacts.length > 1 && (
        <div className="border-t border-gray-200 bg-white p-3">
          <div className="flex gap-2 overflow-x-auto">
            {artifacts.map((artifact, index) => (
              <button
                key={artifact.id}
                onClick={() => setCurrentIndex(index)}
                className={`flex-shrink-0 w-16 h-12 rounded-lg border-2 transition-colors flex items-center justify-center text-xs ${
                  index === currentIndex
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 bg-gray-50"
                }`}
              >
                {getArtifactIcon(artifact.type)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getArtifactIcon(type: Artifact["type"]) {
  switch (type) {
    case "map":
      return "🗺️";
    case "dwelling_map":
      return "📍";
    case "pie_chart":
      return "🥧";
    case "bar_chart":
      return "📊";
    case "table":
      return "📋";
    case "stats":
      return "📈";
    case "property_card":
      return "🏠";
    case "property_breakdown":
      return "🏘️";
    case "dwelling_breakdown":
      return "🏛️";
    default:
      return "📄";
  }
}
