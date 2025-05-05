import { NextResponse } from 'next/server';

interface WebhookMessage {
  id: string;
  createdAt: string;
  payload?: string;
  [key: string]: any;
}

export async function GET(request: Request) {
  try {
    // Get project ID and webhook ID from query parameters
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const webhookId = url.searchParams.get('webhookId');
    // Get optional timestamp to load data before a certain point
    const beforeTimestamp = url.searchParams.get('before');

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

    // URL for fetching webhook messages
    const baseUrl = `https://${projectId}.api.sanity.io/v2021-10-04/hooks/${webhookId}/messages`;

    // Get the token from environment variables
    const token = process.env.SANITY_API_TOKEN?.trim();

    if (!token) {
      throw new Error(
        'SANITY_API_TOKEN is not defined in environment variables'
      );
    }

    // Set up optimized parallel fetching
    const limit = 50; // Maximum allowed by the API
    const MAX_PAGES = 3; // Limit to 3 pages of messages to keep response time low

    // Set the time window based on the 'before' parameter or default to recent data
    let timeWindowStart;
    let timeWindowEnd;

    if (beforeTimestamp) {
      // If 'before' parameter provided, load data from a 12-hour window before that time
      timeWindowEnd = new Date(beforeTimestamp);
      timeWindowStart = new Date(beforeTimestamp);
      timeWindowStart.setHours(timeWindowStart.getHours() - 12);
    } else {
      // Default: load data from the last 6 hours
      timeWindowEnd = new Date();
      timeWindowStart = new Date();
      timeWindowStart.setHours(timeWindowStart.getHours() - 6);
    }

    // Create offsets for parallel requests
    const offsets = Array.from({ length: MAX_PAGES }, (_, i) => i * limit);

    // Execute requests in parallel with Promise.all
    const fetchPromises = offsets.map(async (currentOffset) => {
      const apiUrl = `${baseUrl}?limit=${limit}&offset=${currentOffset}`;

      try {
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

          return []; // Return empty array instead of throwing to allow other requests to complete
        }

        const data = await response.json();

        if (data.length === 0) {
          return [];
        }

        // Filter data to only include messages from the last 6 hours
        const recentMessages = data.filter((message: WebhookMessage) => {
          const messageDate = new Date(message.createdAt);
          return messageDate >= timeWindowStart && messageDate <= timeWindowEnd;
        });

        return recentMessages;
      } catch (error) {
        console.error(
          `Error fetching messages at offset ${currentOffset}:`,
          error
        );
        return []; // Return empty to allow other requests to complete
      }
    });

    // Wait for all requests to complete
    const results = await Promise.all(fetchPromises);

    // Combine results from all requests
    const allMessages = results.flat();

    // Sort messages by createdAt (newest first)
    allMessages.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Process messages to extract document IDs
    const messageIdToDocumentId: Record<string, string> = {};

    interface ParsingError {
      id: string;
      error: string;
    }

    const messagesWithParsingErrors: ParsingError[] = [];

    allMessages.forEach((message) => {
      try {
        if (message.payload) {
          const payload = JSON.parse(message.payload);
          if (payload.after && payload.after._id) {
            messageIdToDocumentId[message.id] = payload.after._id;
          }
        }
      } catch (error) {
        messagesWithParsingErrors.push({
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json({
      documentIds: messageIdToDocumentId,
      messagesWithErrors: messagesWithParsingErrors,
      timestamp: new Date().toISOString(), // Add timestamp for cache validation
      timeWindow: {
        start: timeWindowStart.toISOString(),
        end: timeWindowEnd.toISOString(),
        olderDataAvailable:
          !beforeTimestamp || new Date(timeWindowStart).getTime() > 0, // Indicate if there might be older data
      },
    });
  } catch (error) {
    console.error('Error fetching webhook messages:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch webhook messages',
      },
      { status: 500 }
    );
  }
}
