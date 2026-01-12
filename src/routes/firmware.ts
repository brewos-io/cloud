import { Router } from "express";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiter for firmware release checks
// 30 requests per 15 minutes per IP (reasonable for update checks)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // Skip validation - we trust our reverse proxy
  message: { error: "Too many requests, please try again later" },
});

// Apply rate limiting to all routes
router.use(limiter);

/**
 * GET /api/firmware/releases
 * Proxy endpoint for GitHub releases API
 * 
 * This endpoint proxies requests to GitHub's releases API to avoid CORS issues
 * when the app runs in cloud mode. The cloud server can make direct API calls
 * without browser CORS restrictions.
 * 
 * Query parameters:
 * - per_page: Number of releases to fetch (default: 30)
 * - page: Page number (default: 1)
 */
router.get("/releases", async (req, res) => {
  try {
    const perPage = req.query.per_page ? parseInt(req.query.per_page as string, 10) : 30;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;

    // Validate parameters
    if (isNaN(perPage) || perPage < 1 || perPage > 100) {
      return res.status(400).json({ error: "Invalid per_page parameter (1-100)" });
    }
    if (isNaN(page) || page < 1) {
      return res.status(400).json({ error: "Invalid page parameter (must be >= 1)" });
    }

    // Build GitHub API URL
    const githubUrl = `https://api.github.com/repos/brewos-io/firmware/releases?per_page=${perPage}&page=${page}`;

    // Fetch from GitHub API
    const response = await fetch(githubUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "BrewOS-Cloud/1.0",
      },
    });

    if (!response.ok) {
      // Forward GitHub API error status and message
      const errorText = await response.text();
      console.error(`[Firmware] GitHub API error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: `GitHub API error: ${response.status}`,
        details: errorText,
      });
    }

    const releases = await response.json();

    // Return releases with CORS headers already set by Express CORS middleware
    res.json(releases);
  } catch (error) {
    console.error("[Firmware] Error fetching releases:", error);
    res.status(500).json({
      error: "Failed to fetch firmware releases",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
