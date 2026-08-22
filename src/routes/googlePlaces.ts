import express, { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

// Google Places API configuration
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_API_NEW_BASE_URL = "https://places.googleapis.com/v1";

if (!GOOGLE_PLACES_API_KEY) {
  console.warn(
    "GOOGLE_PLACES_API_KEY is not configured in server environment variables",
  );
}

// Rate limiting for Google Places API calls
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

const checkRateLimit = (req: Request): boolean => {
  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const requests = rateLimitMap.get(clientIp) || [];

  // Remove old requests outside the window
  const validRequests = requests.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW,
  );

  if (validRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  validRequests.push(now);
  rateLimitMap.set(clientIp, validRequests);
  return true;
};

// Get place details (using Places API New)
router.get(
  "/place-details",
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!checkRateLimit(req)) {
        res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
        });
        return;
      }

      const { place_id } = req.query;

      if (!place_id) {
        res.status(400).json({
          success: false,
          error: "place_id parameter is required",
        });
        return;
      }

      if (!GOOGLE_PLACES_API_KEY) {
        res.status(500).json({
          success: false,
          error: "Google Places API is not configured on the server",
        });
        return;
      }

      const apiUrl = `${PLACES_API_NEW_BASE_URL}/places/${place_id as string}`;

      // Define field mask for the fields we need
      // See: https://developers.google.com/maps/documentation/places/web-service/place-details#fieldmask
      // Essential fields to reduce costs
      const fieldMask =
        "displayName,rating,reviews,userRatingCount,formattedAddress,photos";

      const response = await axios.get<any>(apiUrl, {
        headers: {
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": fieldMask,
          Referer: "http://localhost:5173", // Matches your frontend URL
        },
      });

      // Map New API response to Legacy API format
      const result = response.data;
      const mappedResult = {
        place_id: result.id || (place_id as string),
        name: result.displayName?.text || "",
        formatted_address: result.formattedAddress || "",
        rating: result.rating || 0,
        user_ratings_total: result.userRatingCount || 0,
        reviews:
          result.reviews?.map((r: any) => ({
            author_name: r.authorAttribution?.displayName || "Anonymous",
            rating: r.rating || 0,
            relative_time_description: r.relativePublishTimeDescription || "",
            text: r.text?.text || "",
            time: r.publishTime
              ? Math.floor(new Date(r.publishTime).getTime() / 1000)
              : 0,
          })) || [],
        photos:
          result.photos?.map((p: any) => ({
            photo_reference: p.name,
            width: p.widthPx,
            height: p.heightPx,
          })) || [],
      };

      res.json({
        success: true,
        data: mappedResult,
      });
    } catch (error: any) {
      const apiError = error.response?.data?.error;
      if (apiError) {
        console.error(
          "Google Places API Error Details:",
          JSON.stringify(apiError, null, 2),
        );
      }

      res.status(error.response?.status || 500).json({
        success: false,
        error: "Failed to fetch place details",
        message: apiError?.message || error.message || "Unknown error",
        status: apiError?.status || "INTERNAL",
      });
    }
  },
);

// Get autocomplete suggestions (using Places API New)
router.get(
  "/autocomplete",
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!checkRateLimit(req)) {
        res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
        });
        return;
      }

      const { input } = req.query;

      if (!input) {
        res.status(400).json({
          success: false,
          error: "input parameter is required",
        });
        return;
      }

      if (!GOOGLE_PLACES_API_KEY) {
        res.status(500).json({
          success: false,
          error: "Google Places API is not configured on the server",
        });
        return;
      }

      const apiUrl = `${PLACES_API_NEW_BASE_URL}/places:autocomplete`;

      const response = await axios.post<any>(
        apiUrl,
        {
          input: input as string,
          includedPrimaryTypes: ["car_dealer", "establishment"],
        },
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            Referer: "http://localhost:5173",
          },
        },
      );

      // Map to legacy format
      const suggestions = response.data.suggestions?.map((s: any) => ({
        place_id: s.placePrediction?.placeId,
        description: s.placePrediction?.text?.text,
        structured_formatting: {
          main_text: s.placePrediction?.structuredFormat?.mainText?.text,
          secondary_text:
            s.placePrediction?.structuredFormat?.secondaryText?.text,
        },
      }));

      res.json({
        success: true,
        data: suggestions || [],
      });
    } catch (error) {
      console.error("Error fetching autocomplete suggestions:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch autocomplete suggestions",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// Search nearby places (using Places API New)
router.get(
  "/nearbysearch",
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!checkRateLimit(req)) {
        res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
        });
        return;
      }

      const { location, radius, type } = req.query;

      if (!location) {
        res.status(400).json({
          success: false,
          error: "location parameter is required (format: lat,lng)",
        });
        return;
      }

      if (!GOOGLE_PLACES_API_KEY) {
        res.status(500).json({
          success: false,
          error: "Google Places API is not configured on the server",
        });
        return;
      }

      const [lat, lng] = (location as string).split(",").map(Number);
      const apiUrl = `${PLACES_API_NEW_BASE_URL}/places:searchNearby`;

      const response = await axios.post<any>(
        apiUrl,
        {
          includedTypes: [type || "car_dealer"],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: Number(radius) || 5000,
            },
          },
        },
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.currentOpeningHours,places.photos",
            Referer: "http://localhost:5173",
          },
        },
      );

      // Map to legacy format
      const results = response.data.places?.map((p: any) => ({
        place_id: p.id,
        name: p.displayName?.text || "",
        formatted_address: p.formattedAddress,
        rating: p.rating,
        user_ratings_total: p.userRatingCount,
        geometry: {
          location: p.location,
        },
        opening_hours: {
          open_now: p.currentOpeningHours?.openNow,
        },
        photos: p.photos?.map((photo: any) => ({
          photo_reference: photo.name,
        })),
      }));

      res.json({
        success: true,
        data: results || [],
      });
    } catch (error) {
      console.error("Error searching nearby places:", error);
      res.status(500).json({
        success: false,
        error: "Failed to search nearby places",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// Get photo (using Places API New)
router.get("/photo", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!checkRateLimit(req)) {
      res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
      });
      return;
    }

    const { photoreference, maxwidth } = req.query;

    if (!photoreference) {
      res.status(400).json({
        success: false,
        error: "photoreference parameter is required",
      });
      return;
    }

    if (!GOOGLE_PLACES_API_KEY) {
      res.status(500).json({
        success: false,
        error: "Google Places API is not configured on the server",
      });
      return;
    }

    // In New API, the photo reference IS the resource name (places/PLACE_ID/photos/PHOTO_ID)
    // Or it might be what we got from previous response
    const photoResourceName = photoreference as string;
    const maxWidthPx = Number(maxwidth) || 400;

    const apiUrl = `https://places.googleapis.com/v1/${photoResourceName}/media?maxWidthPx=${maxWidthPx}&key=${GOOGLE_PLACES_API_KEY}`;

    // Fetch image and proxy it
    const response = await axios.get<any>(apiUrl, {
      responseType: "arraybuffer",
    });

    res.set({
      "Content-Type": response.headers["content-type"],
      "Content-Length": response.data.length,
      "Cache-Control": "public, max-age=86400", // Cache for 1 day
    });

    res.send(response.data);
  } catch (error) {
    console.error("Error fetching photo:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch photo",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
