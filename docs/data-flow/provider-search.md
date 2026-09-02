# Provider Search Data Flow

## Overview

Provider search connects patients to nearby healthcare based on **reported symptoms, urgency, and care category** — NOT disease prediction.

## Boundaries

### Patient Input
- Symptoms (reported, not diagnosed)
- Urgency class (emergency | urgent_today | soon | monitor | unknown)
- Patient age (optional)

### Care Routing (Deterministic)
- Emergency → emergency_department (always first)
- Pregnancy → obstetric_care
- Eye symptoms → eye_care
- Dental symptoms → dental_care
- Mental health → mental_health
- Pediatric (age < 5) → paediatrics
- Default → primary_care

### Location Flow
- Browser geolocation (opt-in, expires with session)
- Manual location entry (fallback, expires with session)
- Coordinates stored in Redis with session TTL

### Provider Search
- Query: careCategory + location + urgency (optional)
- Mock data: Nairobi, Mombasa, Kisumu, 5-10 providers per category
- Results ranked by: careCategory → emergency → verified → distance → status

### Handoff
- Phone: Available (click to call)
- Navigation: Opens native maps (does NOT store location)
- Booking: Opens provider booking URL if available

## Privacy Guarantees

### What Is NOT Stored
- Raw coordinates after session close
- Symptom transcripts for provider queries
- Precise location in Supabase for anonymous sessions
- Patient phone numbers in logs

### What IS Stored (Ephemeral)
- Session coordinates in Redis (TTL = session TTL)
- Location consent record (no PII, just method + timestamp)
- Search query metadata (no patient health data)

### Third-Party Policies

**Geocoding Provider (Future):**
- Data sent: areaQuery only (no coordinates, no symptoms)
- Retention: Not applicable (mock for now)
- Redaction: N/A

**Provider Directory (Future):**
- Data sent: careCategory + coordinates + urgency (optional)
- Retention: Not applicable (mock for now)
- Redaction: N/A

## Failure Modes

| Failure | Behavior |
|---------|----------|
| Browser geolocation denied | Fallback to manual entry (user enters city name) |
| Provider search timeout | Return cached results or "unavailable" message |
| Invalid coordinates | Reject search, ask for manual entry |
| No providers found | Show "No providers found" + suggest different location |
| API down | Graceful error, offer retry |

## Logging & Observability

### Safe to Log
- careCategory requested
- provider count returned
- search duration
- distance calculations
- opening status matches
- verification age

### Never Log
- Raw coordinates
- Symptom concepts
- Patient wording
- Phone numbers (even truncated)
- Patient age
- Full search query

### Example Safe Event
```json
{
  "event": "provider_search_completed",
  "care_category": "primary_care",
  "urgency": "soon",
  "result_count": 5,
  "search_duration_ms": 150,
  "has_coordinates": true,
  "channel": "web"
}
```

## Access Control

- All endpoints require valid session ID
- No authentication required for anonymous clinic mode
- Location data limited to same session
- No cross-session location access

## Testing Strategy

- Unit: care routing, ranking, distance
- Integration: API endpoints, mock adapter
- E2E: complete flow, denied location fallback, emergency prioritization
- Privacy: no coordinates/symptoms in logs

## Future Enhancements

1. Real geocoding provider (Google Maps API)
2. Real provider directory API
3. Map view (current: list only)
4. Provider ratings/reviews
5. Telemedicine appointment booking
6. Real-time availability syncing
