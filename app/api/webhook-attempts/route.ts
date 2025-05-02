import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    // Get project ID and webhook ID from query parameters
    const url = new URL(request.url)
    const projectId = url.searchParams.get("projectId")
    const webhookId = url.searchParams.get("webhookId")

    // Validate required parameters
    if (!projectId || !webhookId) {
      return NextResponse.json(
        { error: "Missing required parameters: projectId and webhookId are required" },
        { status: 400 },
      )
    }

    // Calculate timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date()
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)
    const fromTimestamp = twentyFourHoursAgo.toISOString()

    // console.log(`Fetching webhook attempts since: ${fromTimestamp}`)

    // Updated URL structure based on Sanity.io API documentation
    const baseUrl = `https://api.sanity.io/v2021-10-04/hooks/projects/${projectId}/${webhookId}/attempts`

    // Get the token from environment variables
    const token = process.env.SANITY_API_TOKEN?.trim()

    if (!token) {
      throw new Error("SANITY_API_TOKEN is not defined in environment variables")
    }

    // Set up for pagination
    const limit = 50 // Maximum allowed by the API
    let offset = 0
    const MAX_OFFSET = 1000 // Maximum offset allowed by the API
    let hasMoreData = true
    let allAttempts = []
    let reachedOldData = false

    // Fetch data with pagination, stopping when we reach data older than 24 hours or max offset
    while (hasMoreData && !reachedOldData && offset < MAX_OFFSET) {
      const apiUrl = `${baseUrl}?limit=${limit}&offset=${offset}`
      // console.log(`Fetching from: ${apiUrl} (offset: ${offset})`)

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      })

      // Log response status for debugging
      // console.log(`Response status: ${response.status}`)

      if (!response.ok) {
        // Try to get more detailed error information
        let errorText = ""
        try {
          const errorData = await response.json()
          errorText = JSON.stringify(errorData)
        } catch {
          errorText = await response.text()
        }

        console.error(`API error: ${response.status} - ${errorText}`)
        throw new Error(`API responded with status: ${response.status}${errorText ? ` - ${errorText}` : ""}`)
      }

      const data = await response.json()
      // console.log(`Fetched ${data.length} attempts`)

      if (data.length === 0) {
        hasMoreData = false
        continue
      }

      // Filter data to only include attempts from the last 24 hours
      const recentAttempts = data.filter((attempt) => {
        const attemptDate = new Date(attempt.createdAt)
        return attemptDate >= twentyFourHoursAgo
      })

      console.log(`${recentAttempts.length} attempts are within the last 24 hours`)

      // Add the recent attempts to our collection
      allAttempts = [...allAttempts, ...recentAttempts]

      // Check if we've reached data older than 24 hours
      if (recentAttempts.length < data.length) {
        // We've started seeing data from more than 24 hours ago
        reachedOldData = true
        console.log("Reached data older than 24 hours, stopping pagination")
      } else if (data.length < limit) {
        // We've reached the end of the data
        hasMoreData = false
      } else {
        // Move to the next page
        offset += limit

        // Check if next offset would exceed the maximum
        if (offset >= MAX_OFFSET) {
          console.log(`Reached maximum offset limit of ${MAX_OFFSET}, stopping pagination`)
          hasMoreData = false
        }
      }
    }

    // Log summary of data fetching
    if (offset >= MAX_OFFSET) {
      console.log(`Note: Only fetched data up to offset ${MAX_OFFSET} due to API limitations`)
    }

    console.log(`Total attempts fetched (last 24 hours): ${allAttempts.length}`)
    return NextResponse.json(allAttempts)
  } catch (error) {
    console.error("Error fetching webhook attempts:", error)
    return NextResponse.json({ error: error.message || "Failed to fetch webhook attempts" }, { status: 500 })
  }
}
