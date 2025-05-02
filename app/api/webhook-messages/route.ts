import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // Get project ID and webhook ID from query parameters
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const webhookId = url.searchParams.get('webhookId');

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

    // Set up for pagination
    const limit = 50; // Maximum allowed by the API
    let offset = 0;
    const MAX_OFFSET = 1000; // Maximum offset allowed by the API
    let hasMoreData = true;
    let allMessages = [];

    // Calculate timestamp for 24 hours ago (same as attempts)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Fetch data with pagination
    while (hasMoreData && offset < MAX_OFFSET) {
      const apiUrl = `${baseUrl}?limit=${limit}&offset=${offset}`;
      // console.log(`Fetching messages from: ${apiUrl} (offset: ${offset})`)

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      // Log response status for debugging
      // console.log(`Response status: ${response.status}`)

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
        throw new Error(
          `API responded with status: ${response.status}${
            errorText ? ` - ${errorText}` : ''
          }`
        );
      }

      const data = await response.json();
      console.log(`Fetched ${data.length} messages`);

      if (data.length === 0) {
        hasMoreData = false;
        continue;
      }

      // Filter data to only include messages from the last 24 hours
      const recentMessages = data.filter((message) => {
        const messageDate = new Date(message.createdAt);
        return messageDate >= twentyFourHoursAgo;
      });

      console.log(
        `${recentMessages.length} messages are within the last 24 hours`
      );

      // Add the recent messages to our collection
      allMessages = [...allMessages, ...recentMessages];

      // Check if we've reached data older than 24 hours
      if (recentMessages.length < data.length) {
        // We've started seeing data from more than 24 hours ago
        hasMoreData = false;
        console.log(
          'Reached messages older than 24 hours, stopping pagination'
        );
      } else if (data.length < limit) {
        // We've reached the end of the data
        hasMoreData = false;
      } else {
        // Move to the next page
        offset += limit;

        // Check if next offset would exceed the maximum
        if (offset >= MAX_OFFSET) {
          console.log(
            `Reached maximum offset limit of ${MAX_OFFSET}, stopping pagination`
          );
          hasMoreData = false;
        }
      }
    }

    // Process messages to extract document IDs
    const messageIdToDocumentId = {};
    const messagesWithParsingErrors = [];

    allMessages.forEach((message) => {
      try {
        if (message.payload) {
          const payload = JSON.parse(message.payload);
          if (payload.after && payload.after._id) {
            messageIdToDocumentId[message.id] = payload.after._id;
          }
        }
      } catch (error) {
        // console.error(
        //   `Error parsing payload for message ${message.id}: ${error.message}`
        // );
        messagesWithParsingErrors.push({
          id: message.id,
          error: error.message,
          payload: message.payload
            ? message.payload.substring(0, 100) + '...'
            : null, // Include a snippet of the problematic payload
        });
      }
    });

    console.log(
      `Extracted document IDs for ${
        Object.keys(messageIdToDocumentId).length
      } messages`
    );
    console.log(
      `Found ${messagesWithParsingErrors.length} messages with JSON parsing errors`
    );

    return NextResponse.json({
      documentIds: messageIdToDocumentId,
      messagesWithErrors: messagesWithParsingErrors,
      timestamp: new Date().toISOString(), // Add timestamp for cache validation
    });
  } catch (error) {
    console.error('Error fetching webhook messages:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch webhook messages' },
      { status: 500 }
    );
  }
}
