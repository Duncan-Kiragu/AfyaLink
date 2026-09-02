import { useState } from "react";

interface ManualLocationInputProps {
  onSubmit: (location: string) => void;
}

export function ManualLocationInput({ onSubmit }: ManualLocationInputProps) {
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) return;

    setIsLoading(true);
    onSubmit(location);
    setIsLoading(false);
  };

  const suggestions = ["Nairobi", "Mombasa", "Kisumu"];

  return (
    <div className="manual-location-input">
      <form onSubmit={handleSubmit}>
        <label htmlFor="location">Enter your city or area:</label>
        <input
          id="location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., Nairobi, Westlands"
          disabled={isLoading}
        />
        <button type="submit" disabled={!location.trim() || isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </button>
      </form>

      <div className="suggestions">
        <p>Popular areas:</p>
        <div className="suggestion-buttons">
          {suggestions.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => {
                setLocation(city);
                onSubmit(city);
              }}
            >
              {city}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
