UPDATE itinerary_presets SET value = regexp_replace(value, '^([^?!.]*[?!.]) ', E'\\1\n\n') WHERE kind='message' AND value !~ E'\n\n';
