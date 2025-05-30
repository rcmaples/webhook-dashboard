import { NextResponse } from 'next/server';

// Define the attempt type based on the Sanity API response
interface WebhookAttempt {
  createdAt: string;
  [key: string]: any;
}

export async function GET(request: Request) {
  try {
    // Get project ID and webhook ID from query parameters
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const webhookId = url.searchParams.get('webhookId');
    // Get pagination parameters from query
    const offsetParam = url.searchParams.get('offset');
    const limitParam = url.searchParams.get('limit');
    // Get optional timestamp to load data before a certain point
    const beforeTimestamp = url.searchParams.get('before');

    // Parse pagination parameters with defaults
    const initialOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 50; // Max 50 per request
    const MAX_OFFSET = 950; // Maximum offset allowed (1000 total results)
    const MAX_PAGES = 10; // Maximum number of pages to fetch

    // Validate required parameters
    if (!projectId || !webhookId) {
      return NextResponse.json(
        {
          error:
            'Missing required parameters: projectId and webhookId are required',
        },
        { status: 400 }
      );
    }

    // Set the time window based on the 'before' parameter or default to recent data
    let timeWindowStart;
    let timeWindowEnd;

    if (beforeTimestamp) {
      // If 'before' parameter provided, load data from a 24-hour window before that time
      timeWindowEnd = new Date(beforeTimestamp);
      timeWindowStart = new Date(beforeTimestamp);
      timeWindowStart.setHours(timeWindowStart.getHours() - 24);
    } else {
      // Default: load data from the last 12 hours
      timeWindowEnd = new Date();
      timeWindowStart = new Date();
      timeWindowStart.setHours(timeWindowStart.getHours() - 12);
    }

    // Updated URL structure based on Sanity.io API documentation
    const baseUrl = `https://api.sanity.io/v2021-10-04/hooks/projects/${projectId}/${webhookId}/attempts`;

    // Get the token from environment variables
    const token = process.env.SANITY_API_TOKEN?.trim();

    if (!token) {
      throw new Error(
        'SANITY_API_TOKEN is not defined in environment variables'
      );
    }

    // Set up for parallel requests
    const MAX_PARALLEL_REQUESTS = 3; // Maximum number of parallel requests
    const PAGES_TO_FETCH = Math.min(MAX_PAGES, 5); // Fetch fewer pages to speed up response

    // Create an array of offsets for parallel fetching
    const offsets = Array.from(
      { length: PAGES_TO_FETCH },
      (_, i) => initialOffset + i * limit
    );

    // Execute requests in parallel with Promise.all
    const requestPromises = offsets.map(async (currentOffset) => {
      // Construct the API URL with pagination parameters
      const apiUrl = `${baseUrl}?limit=${limit}&offset=${currentOffset}`;

      try {
        // Fetch data
        const response = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
        });

        if (!response.ok) {
          // Try to get more detailed error information
          let errorText = '';
          try {
            const errorData = await response.json();
            errorText = JSON.stringify(errorData);
          } catch {
            errorText = await response.text();
          }

          console.error(`API error: ${response.status} - ${errorText}`);
          return []; // Return empty array instead of throwing to allow other requests to complete
        }

        const data = (await response.json()) as WebhookAttempt[];

        // Filter data to only include attempts from the last 12 hours
        const recentAttempts = data.filter((attempt: WebhookAttempt) => {
          const attemptDate = new Date(attempt.createdAt);
          return attemptDate >= timeWindowStart && attemptDate <= timeWindowEnd;
        });

        const timeWindowDescription = beforeTimestamp
          ? 'the specified time window'
          : 'the last 12 hours';

        return recentAttempts;
      } catch (error) {
        console.error(
          `Error fetching batch at offset ${currentOffset}:`,
          error
        );
        return []; // Return empty array to allow other requests to complete
      }
    });

    // Wait for all requests to complete
    const results = await Promise.all(requestPromises);

    // Combine results from all requests
    let allAttempts = results.flat();

    // Sort attempts by createdAt date (newest first)
    allAttempts.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // There might be more data available
    const hasMore = offsets.length >= MAX_PAGES;

    // Return the data with pagination metadata and time window information
    return NextResponse.json({
      attempts: allAttempts,
      pagination: {
        offset: initialOffset,
        limit,
        hasMore,
        nextOffset: hasMore ? initialOffset + limit : null,
        totalFetched: allAttempts.length,
        pages: PAGES_TO_FETCH,
      },
      timeWindow: {
        start: timeWindowStart.toISOString(),
        end: timeWindowEnd.toISOString(),
        olderDataAvailable:
          !beforeTimestamp || new Date(timeWindowStart).getTime() > 0, // Indicate if there might be older data
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching webhook attempts:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch webhook attempts',
      },
      { status: 500 }
    );
  }
}
