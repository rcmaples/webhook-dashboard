'use client';

import React from 'react';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
  ChevronDown,
  ChevronUp,
  Search,
  XCircle,
  RefreshCw,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileText,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsDialog } from '@/components/settings-dialog';

interface Attempt {
  id: string;
  projectId: string;
  inProgress: boolean;
  duration: number;
  createdAt: string;
  updatedAt: string;
  messageId: string;
  hookId: string;
  isFailure: boolean;
  failureReason: string;
  resultCode: number;
  resultBody: string;
}

// Cache settings
const CACHE_STORAGE_KEY = 'webhook-monitor-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface CachedData {
  attempts: Attempt[];
  documentIds: Record<string, string>;
  messagesWithErrors: MessageWithError[];
  timestamp: string;
  hasMoreData?: boolean;
}

interface ProcessedMessage {
  messageId: string;
  oldestAttempt: string;
  newestAttempt: string;
  attemptCount: number;
  successRate: number;
  hookId: string;
  documentId?: string;
  attempts: Attempt[];
  latestFailure: Attempt | null;
  parsingError: string | null;
  largePayloadFailure?: boolean;
}

// States for progressive loading
enum LoadingState {
  IDLE = 'idle',
  LOADING_INITIAL = 'loading_initial',
  LOADING_FULL = 'loading_full',
  COMPLETE = 'complete',
  ERROR = 'error',
}

// Define sort types
type SortField =
  | 'messageId'
  | 'documentId'
  | 'oldestAttempt'
  | 'newestAttempt'
  | 'attemptCount'
  | 'successRate';
type SortDirection = 'asc' | 'desc';

// Default settings
const DEFAULT_SETTINGS = {
  projectId: 'czqk28jt',
  webhookId: 'g9qVzHvYoAWPfivG',
};

// Local storage key
const SETTINGS_STORAGE_KEY = 'webhook-monitor-settings';

interface MessageWithError {
  id: string;
  error: string;
  payload?: string;
}

export default function WebhookMonitor() {
  const [messages, setMessages] = useState<ProcessedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingState, setLoadingState] = useState<LoadingState>(
    LoadingState.IDLE
  );
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set()
  );
  const [messagesWithParsingErrors, setMessagesWithParsingErrors] = useState<
    Map<string, string>
  >(new Map());
  // Add loading progress tracking
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  // States for loading older data
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasOlderData, setHasOlderData] = useState(true);

  // Settings state
  const [settings, setSettings] = useState(() => {
    // Initialize from localStorage if available
    if (typeof window !== 'undefined') {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        try {
          return JSON.parse(savedSettings);
        } catch (e) {
          console.error('Failed to parse saved settings:', e);
        }
      }
    }
    return DEFAULT_SETTINGS;
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('newestAttempt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  // Reset data and fetch when settings change
  useEffect(() => {
    setMessages([]);
    setError(null);
    setLoadingProgress(0);
    setTotalItems(0);
    fetchData();
  }, [settings]);

  const fetchData = async (forceRefresh = false, before?: string) => {
    try {
      // If loading more data, use a different loading state
      if (before) {
        setIsLoadingMore(true);
      } else {
        setLoadingState(LoadingState.LOADING_INITIAL);
        setIsLoading(true);
        setError(null);
        setLoadingProgress(0);
        setTotalItems(0);
      }

      // Add project ID and webhook ID as query parameters
      const queryParams = new URLSearchParams({
        projectId: settings.projectId,
        webhookId: settings.webhookId,
      });

      // Add the 'before' parameter if provided
      if (before) {
        queryParams.append('before', before);
      }

      const queryString = queryParams.toString();

      // Fetch both attempts and messages in parallel
      const attemptsPromise = fetch(`/api/webhook-attempts?${queryString}`);
      const messagesPromise = fetch(`/api/webhook-messages?${queryString}`);

      // Show initial progress quickly - just show the first 20 attempts to get something on screen
      const initialAttemptsResponse = await attemptsPromise;

      if (!initialAttemptsResponse.ok) {
        const errorData = await initialAttemptsResponse.json();
        throw new Error(
          errorData.error ||
            `Attempts API responded with status: ${initialAttemptsResponse.status}`
        );
      }

      const attemptsData = await initialAttemptsResponse.json();

      // Display more detail about the data shape
      if (attemptsData.attempts?.length > 0) {
        // Count unique message IDs to understand grouping potential
        const messageIds = new Set();
        attemptsData.attempts.forEach((attempt: Attempt) => {
          if (attempt.messageId) {
            messageIds.add(attempt.messageId);
          }
        });
      }

      const allAttempts: Attempt[] = attemptsData.attempts || [];

      // Process the first batch quickly to show something on screen
      const initialBatchSize = Math.min(50, allAttempts.length);
      const initialAttempts = allAttempts.slice(0, initialBatchSize);

      // Get an initial empty document mapping - we'll fill it later
      const initialDocumentIds: Record<string, string> = {};

      // Process just the initial batch to show something fast
      processApiData(initialAttempts, initialDocumentIds, [], isLoadingMore);

      // Update loading state to indicate we're now loading the full dataset
      setLoadingState(LoadingState.LOADING_FULL);
      setIsLoading(false); // We have some data to show now

      // Process the remaining data in batches
      const batchSize = 100; // Process 100 attempts at a time
      const remainingAttempts = allAttempts.slice(initialBatchSize);

      // Set total items for progress tracking
      setTotalItems(allAttempts.length);
      setLoadingProgress(initialBatchSize);

      try {
        // Start loading messages data in parallel
        const messagesPromiseResult = messagesPromise;

        // Process remaining attempts in batches while waiting for messages
        for (let i = 0; i < remainingAttempts.length; i += batchSize) {
          const batchEnd = Math.min(i + batchSize, remainingAttempts.length);
          const currentBatch = allAttempts.slice(
            0,
            initialBatchSize + batchEnd
          );

          // Update UI with what we have so far
          processApiData(currentBatch, initialDocumentIds, [], isLoadingMore);

          // Update progress
          const processedCount = initialBatchSize + batchEnd;
          setLoadingProgress(processedCount);

          // Small delay to allow UI to update and not block rendering
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        // Now get the messages data (should be ready or nearly ready by now)
        const messagesResponse = await messagesPromiseResult;

        if (!messagesResponse.ok) {
          const errorData = await messagesResponse.json();
          console.error(
            `Messages API responded with status: ${messagesResponse.status}`,
            errorData
          );
          // Don't throw here, we'll still show what we have
        } else {
          const messagesData = await messagesResponse.json();
          const messageIdToDocumentId = messagesData.documentIds || {};
          const messagesWithErrors: MessageWithError[] =
            messagesData.messagesWithErrors || [];

          // Cache the raw API data with a hasMore flag to indicate more data might be available
          const cacheData: CachedData = {
            attempts: allAttempts,
            documentIds: messageIdToDocumentId,
            messagesWithErrors,
            timestamp: new Date().toISOString(),
            hasMoreData: true, // Indicate that there may be more data beyond what we've fetched
          };
          localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cacheData));

          // Final processing with all the data
          processApiData(
            allAttempts,
            messageIdToDocumentId,
            messagesWithErrors,
            isLoadingMore
          );

          // Set final progress
          setLoadingProgress(allAttempts.length);
        }
      } catch (err) {
        console.error('Error processing full dataset:', err);
        // We still have initial data, so don't reset everything
      }

      setLoadingState(LoadingState.COMPLETE);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred'
      );
      setLoadingState(LoadingState.ERROR);
    } finally {
      setIsLoading(false);
    }
  };

  // Extract data processing logic to a separate function
  const processApiData = (
    attempts: Attempt[],
    messageIdToDocumentId: Record<string, string>,
    messagesWithErrors: MessageWithError[],
    isLoadingMoreData = false
  ) => {
    // Create a Map for error messages for easier lookup
    const errorMap = new Map<string, string>();
    messagesWithErrors.forEach((item) => {
      errorMap.set(item.id, item.error);
    });
    setMessagesWithParsingErrors(errorMap);

    // Track message IDs with parsing errors
    const errorMessageIds = messagesWithErrors.map((item) => item.id);

    // Process the data to group by messageId
    const messageMap = new Map<string, Attempt[]>();

    attempts.forEach((attempt) => {
      if (!attempt.messageId) {
        return;
      }

      if (!messageMap.has(attempt.messageId)) {
        messageMap.set(attempt.messageId, []);
      }
      messageMap.get(attempt.messageId)?.push(attempt);
    });

    // Calculate the required information for each message
    const processedMessages: ProcessedMessage[] = [];

    messageMap.forEach((attempts, messageId) => {
      // Sort attempts by createdAt
      attempts.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const oldestAttempt = attempts[0].createdAt;
      const newestAttempt = attempts[attempts.length - 1].createdAt;
      const attemptCount = attempts.length;

      // Calculate success rate
      const successfulAttempts = attempts.filter((a) => !a.isFailure).length;
      const successRate = (successfulAttempts / attemptCount) * 100;

      // Find the latest failure (if any)
      const failedAttempts = attempts.filter((a) => a.isFailure);
      const latestFailure =
        failedAttempts.length > 0
          ? failedAttempts[failedAttempts.length - 1]
          : null;

      // Check if the failure is due to a large payload
      const isLargePayloadFailure = latestFailure
        ? latestFailure.failureReason
            ?.toLowerCase()
            .includes('payload too large') ||
          latestFailure.failureReason
            ?.toLowerCase()
            .includes('request entity too large') ||
          latestFailure.resultBody
            ?.toLowerCase()
            .includes('payload too large') ||
          latestFailure.resultCode === 413
        : undefined;

      // Get document ID if available
      const documentId = messageIdToDocumentId[messageId] || undefined;

      processedMessages.push({
        messageId,
        oldestAttempt,
        newestAttempt,
        attemptCount,
        successRate,
        hookId: attempts[0].hookId,
        documentId:
          messageId in messageIdToDocumentId
            ? (messageIdToDocumentId as Record<string, string>)[messageId]
            : undefined,
        attempts,
        latestFailure,
        parsingError: errorMap.get(messageId) || null,
        largePayloadFailure: isLargePayloadFailure,
      });
    });

    // Sort by newest attempt date (descending) by default
    processedMessages.sort(
      (a, b) =>
        new Date(b.newestAttempt).getTime() -
        new Date(a.newestAttempt).getTime()
    );

    // If loading more data, merge with existing messages
    if (isLoadingMoreData && messages.length > 0) {
      // Create lookup maps with existing data
      const existingMessageMap = new Map<string, ProcessedMessage>();
      const existingAttemptMap = new Map<string, boolean>();

      // Track existing message IDs and attempt IDs to avoid duplicates
      messages.forEach((msg) => {
        existingMessageMap.set(msg.messageId, msg);
        msg.attempts.forEach((attempt) => {
          existingAttemptMap.set(attempt.id, true);
        });
      });

      let newAddedCount = 0;
      let updatedCount = 0;

      // Process new messages and merge with existing ones if needed
      const combinedMessagesMap = new Map<string, ProcessedMessage>(
        messages.map((msg) => [msg.messageId, { ...msg }])
      );

      // Process each new message
      processedMessages.forEach((newMsg) => {
        if (existingMessageMap.has(newMsg.messageId)) {
          // This message exists - check if we need to merge attempts
          const existingMsg = combinedMessagesMap.get(newMsg.messageId)!;

          // Filter out attempts we already have
          const newAttempts = newMsg.attempts.filter(
            (attempt) => !existingAttemptMap.has(attempt.id)
          );

          if (newAttempts.length > 0) {
            // We have new attempts to add to this message
            const combinedAttempts = [...existingMsg.attempts, ...newAttempts];

            // Sort attempts by creation time
            combinedAttempts.sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime()
            );

            // Update the message with combined attempts
            const updatedMsg: ProcessedMessage = {
              ...existingMsg,
              attempts: combinedAttempts,
              oldestAttempt: combinedAttempts[0].createdAt,
              newestAttempt:
                combinedAttempts[combinedAttempts.length - 1].createdAt,
              attemptCount: combinedAttempts.length,
            };

            // Recalculate success rate
            const successfulAttempts = combinedAttempts.filter(
              (a) => !a.isFailure
            ).length;
            updatedMsg.successRate =
              (successfulAttempts / combinedAttempts.length) * 100;

            // Update latest failure if needed
            const failedAttempts = combinedAttempts.filter((a) => a.isFailure);
            updatedMsg.latestFailure =
              failedAttempts.length > 0
                ? failedAttempts[failedAttempts.length - 1]
                : null;

            combinedMessagesMap.set(newMsg.messageId, updatedMsg);
            updatedCount++;
          }
        } else {
          // This is a completely new message
          combinedMessagesMap.set(newMsg.messageId, newMsg);
          newAddedCount++;
        }
      });

      // Convert map back to array and sort
      const combinedMessages = Array.from(combinedMessagesMap.values());
      combinedMessages.sort(
        (a, b) =>
          new Date(b.newestAttempt).getTime() -
          new Date(a.newestAttempt).getTime()
      );

      setMessages(combinedMessages);
    } else {
      // Just set the messages directly if not loading more
      setMessages(processedMessages);
    }
  };

  const handleSaveSettings = (newSettings: typeof DEFAULT_SETTINGS) => {
    setSettings(newSettings);
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const getTimeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (e) {
      console.error('Error formatting date:', dateString, e);
      return 'Unknown';
    }
  };

  const getStatusBadge = (successRate: number) => {
    if (successRate === 100) {
      return <Badge className="bg-green-500">Success</Badge>;
    } else if (successRate === 0) {
      return <Badge variant="destructive">Failed</Badge>;
    } else {
      return (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
          Partial ({successRate.toFixed(0)}%)
        </Badge>
      );
    }
  };

  const toggleExpand = (messageId: string) => {
    setExpandedMessages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const formatResultBody = (body: string) => {
    try {
      // Try to parse as JSON for better formatting
      const parsed = JSON.parse(body);
      return (
        <pre className="text-xs overflow-auto max-h-[200px] bg-gray-50 dark:bg-gray-900 p-2 rounded">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch (e) {
      // If not JSON, return as plain text
      return (
        <pre className="text-xs overflow-auto max-h-[200px] bg-gray-50 dark:bg-gray-900 p-2 rounded">
          {body}
        </pre>
      );
    }
  };

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and default to descending for dates, ascending for others
      setSortField(field);
      setSortDirection(
        field.includes('Attempt')
          ? 'desc'
          : field === 'attemptCount'
          ? 'desc'
          : 'asc'
      );
    }
  };

  // Get sort icon for column header
  const getSortIcon = (field: SortField) => {
    if (field !== sortField) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

  const filteredMessages = messages.filter((message) => {
    // Apply search filter (case insensitive)
    const matchesSearch =
      searchQuery === '' ||
      message.messageId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (message.documentId &&
        message.documentId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      message.hookId.toLowerCase().includes(searchQuery.toLowerCase());

    // Apply status filter
    let matchesStatus = true;
    if (statusFilter === 'success') {
      matchesStatus = message.successRate === 100;
    } else if (statusFilter === 'failed') {
      matchesStatus = message.successRate === 0;
    } else if (statusFilter === 'partial') {
      matchesStatus = message.successRate > 0 && message.successRate < 100;
    }

    return matchesSearch && matchesStatus;
  });

  // Sort the filtered messages
  const sortedMessages = [...filteredMessages].sort((a, b) => {
    switch (sortField) {
      case 'messageId':
        return sortDirection === 'asc'
          ? a.messageId.localeCompare(b.messageId)
          : b.messageId.localeCompare(a.messageId);

      case 'documentId':
        // Handle undefined document IDs
        if (!a.documentId && !b.documentId) return 0;
        if (!a.documentId) return sortDirection === 'asc' ? -1 : 1;
        if (!b.documentId) return sortDirection === 'asc' ? 1 : -1;
        return sortDirection === 'asc'
          ? a.documentId.localeCompare(b.documentId)
          : b.documentId.localeCompare(a.documentId);

      case 'oldestAttempt':
        return sortDirection === 'asc'
          ? new Date(a.oldestAttempt).getTime() -
              new Date(b.oldestAttempt).getTime()
          : new Date(b.oldestAttempt).getTime() -
              new Date(a.oldestAttempt).getTime();

      case 'newestAttempt':
        return sortDirection === 'asc'
          ? new Date(a.newestAttempt).getTime() -
              new Date(b.newestAttempt).getTime()
          : new Date(b.newestAttempt).getTime() -
              new Date(a.newestAttempt).getTime();

      case 'attemptCount':
        return sortDirection === 'asc'
          ? a.attemptCount - b.attemptCount
          : b.attemptCount - a.attemptCount;

      case 'successRate':
        return sortDirection === 'asc'
          ? a.successRate - b.successRate
          : b.successRate - a.successRate;

      default:
        return 0;
    }
  });

  // Pagination logic
  const totalPages = Math.ceil(sortedMessages.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sortedMessages.length);
  const currentMessages = sortedMessages.slice(startIndex, endIndex);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    // Use window width to determine how many pages to show
    // Default to 5 on mobile, more on larger screens
    const maxVisiblePages = window.innerWidth >= 768 ? 7 : 5;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if there are few
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      // Calculate range around current page
      const pagesAroundCurrent = Math.floor((maxVisiblePages - 2) / 2);
      let startPage = Math.max(2, currentPage - pagesAroundCurrent);
      let endPage = Math.min(totalPages - 1, currentPage + pagesAroundCurrent);

      // Adjust if at edges
      if (currentPage <= pagesAroundCurrent + 1) {
        endPage = Math.min(maxVisiblePages - 1, totalPages - 1);
      } else if (currentPage >= totalPages - pagesAroundCurrent) {
        startPage = Math.max(2, totalPages - maxVisiblePages + 2);
      }

      // Add ellipsis if needed
      if (startPage > 2) {
        pages.push('ellipsis-start');
      }

      // Add middle pages
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      // Add ellipsis if needed
      if (endPage < totalPages - 1) {
        pages.push('ellipsis-end');
      }

      // Always show last page if not already included
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  // Add a function to load older data
  const handleLoadMore = async () => {
    if (isLoadingMore || messages.length === 0) return;

    setIsLoadingMore(true);
    try {
      // Find the oldest message
      const oldestMessage = [...messages].sort(
        (a, b) =>
          new Date(a.oldestAttempt).getTime() -
          new Date(b.oldestAttempt).getTime()
      )[0];

      if (!oldestMessage) {
        setIsLoadingMore(false);
        return;
      }

      // Calculate timestamp for the oldest attempt and subtract 1 minute to avoid overlap
      const oldestDate = new Date(oldestMessage.oldestAttempt);
      oldestDate.setMinutes(oldestDate.getMinutes() - 1); // Go 1 minute further back to avoid overlap

      // Add project ID and webhook ID as query parameters
      const queryParams = new URLSearchParams({
        projectId: settings.projectId,
        webhookId: settings.webhookId,
        before: oldestDate.toISOString(),
      });

      const queryString = queryParams.toString();

      // Fetch both attempts and messages with the before parameter
      const [attemptsResponse, messagesResponse] = await Promise.all([
        fetch(`/api/webhook-attempts?${queryString}`),
        fetch(`/api/webhook-messages?${queryString}`),
      ]);

      if (!attemptsResponse.ok) {
        throw new Error(
          `Attempts API responded with status: ${attemptsResponse.status}`
        );
      }

      const attemptsData = await attemptsResponse.json();
      const allAttempts = attemptsData.attempts || [];

      // If no attempts, there's no more data
      if (allAttempts.length === 0) {
        setHasOlderData(false);
        return;
      }

      // Process messages to get document IDs
      let messageIdToDocumentId: Record<string, string> = {};
      let messagesWithErrors: MessageWithError[] = [];

      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json();
        messageIdToDocumentId = messagesData.documentIds || {};
        messagesWithErrors = messagesData.messagesWithErrors || [];
      }

      // Pass isLoadingMore as true to ensure data is merged properly
      processApiData(
        allAttempts,
        messageIdToDocumentId,
        messagesWithErrors,
        true
      );
    } catch (error) {
      console.error('Error loading more data:', error);
      setError(
        error instanceof Error ? error.message : 'Failed to load more data'
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Webhook Attempts Monitor</CardTitle>
            <CardDescription>
              Monitoring webhook delivery attempts and success rates
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <SettingsDialog
              settings={settings}
              onSave={handleSaveSettings}
              onReset={handleResetSettings}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)} // Pass true to force refresh
              disabled={loadingState === LoadingState.LOADING_INITIAL}
              className="flex items-center gap-1">
              <RefreshCw
                className={`h-4 w-4 ${
                  loadingState === LoadingState.LOADING_INITIAL ||
                  loadingState === LoadingState.LOADING_FULL
                    ? 'animate-spin'
                    : ''
                }`}
              />
              {loadingState === LoadingState.LOADING_INITIAL
                ? 'Loading...'
                : loadingState === LoadingState.LOADING_FULL
                ? 'Loading more...'
                : 'Refresh Data'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Current Settings:</span>
              <span>
                Project ID:{' '}
                <code className="bg-blue-100 dark:bg-blue-800 px-1 py-0.5 rounded">
                  {settings.projectId}
                </code>
              </span>
              <span>
                Webhook ID:{' '}
                <code className="bg-blue-100 dark:bg-blue-800 px-1 py-0.5 rounded">
                  {settings.webhookId}
                </code>
              </span>
            </div>
          </div>

          {loadingState === LoadingState.LOADING_INITIAL ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <div className="grid grid-cols-7 gap-4">
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
                <Skeleton className="h-4 col-span-1" />
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="grid grid-cols-7 gap-4">
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                  <Skeleton className="h-8 col-span-1" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No webhook attempts found.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row gap-4 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by message ID, document ID, or hook ID..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="w-full md:w-[200px]">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="partial">Partial Success</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(searchQuery || statusFilter !== 'all') && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}>
                    Clear Filters
                  </Button>
                )}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead
                        className="w-[250px] cursor-pointer"
                        onClick={() => handleSort('messageId')}>
                        <div className="flex items-center">
                          Message ID
                          {getSortIcon('messageId')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer"
                        onClick={() => handleSort('oldestAttempt')}>
                        <div className="flex items-center">
                          First Attempt
                          {getSortIcon('oldestAttempt')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer"
                        onClick={() => handleSort('newestAttempt')}>
                        <div className="flex items-center">
                          Last Attempt
                          {getSortIcon('newestAttempt')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-center cursor-pointer"
                        onClick={() => handleSort('attemptCount')}>
                        <div className="flex items-center justify-center">
                          Attempts
                          {getSortIcon('attemptCount')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-center cursor-pointer"
                        onClick={() => handleSort('successRate')}>
                        <div className="flex items-center justify-center">
                          Status
                          {getSortIcon('successRate')}
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex items-center justify-center">
                          Issues
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentMessages.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                          No results found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      currentMessages.map((message, index) => (
                        <React.Fragment key={`${message.messageId}-${index}`}>
                          <TableRow
                            className={
                              message.successRate < 100
                                ? 'bg-red-50 dark:bg-red-950/20'
                                : ''
                            }>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleExpand(message.messageId)}
                                aria-label={
                                  expandedMessages.has(message.messageId)
                                    ? 'Collapse details'
                                    : 'Expand details'
                                }>
                                {expandedMessages.has(message.messageId) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium">
                              <div
                                className="truncate max-w-[250px]"
                                title={message.messageId}>
                                {message.messageId}
                              </div>
                              {message.documentId ? (
                                <div
                                  className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 truncate"
                                  title={message.documentId}>
                                  <FileText className="h-3 w-3" />
                                  Document: {message.documentId}
                                </div>
                              ) : messagesWithParsingErrors.has(
                                  message.messageId
                                ) ? (
                                <div className="text-xs text-amber-600 dark:text-amber-400 truncate">
                                  Unable to parse document ID due to control
                                  characters
                                </div>
                              ) : message.largePayloadFailure ? (
                                <div className="text-xs text-amber-600 dark:text-amber-400 truncate">
                                  Unable to process document ID - payload too
                                  large
                                </div>
                              ) : (
                                ''
                              )}
                            </TableCell>
                            <TableCell>
                              <div>{formatDate(message.oldestAttempt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {getTimeAgo(message.oldestAttempt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>{formatDate(message.newestAttempt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {getTimeAgo(message.newestAttempt)}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              {message.attemptCount}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(message.successRate)}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-wrap gap-1 justify-center">
                                {message.latestFailure && (
                                  <Badge
                                    variant={
                                      message.latestFailure.resultCode >= 500
                                        ? 'destructive'
                                        : 'outline'
                                    }
                                    className="text-xs">
                                    {message.latestFailure.resultCode}
                                  </Badge>
                                )}
                                {message.largePayloadFailure && (
                                  <Badge
                                    variant="outline"
                                    className="bg-amber-100 text-amber-800 text-xs">
                                    Large Payload
                                  </Badge>
                                )}
                                {messagesWithParsingErrors.has(
                                  message.messageId
                                ) && (
                                  <Badge
                                    variant="outline"
                                    className="bg-yellow-100 text-yellow-800 text-xs">
                                    Parse Error
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {expandedMessages.has(message.messageId) && (
                            <TableRow>
                              <TableCell
                                colSpan={7}
                                className="bg-gray-50 dark:bg-gray-900 p-0">
                                <div className="p-4">
                                  {message.parsingError && (
                                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                                      <div className="flex items-start gap-2">
                                        <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
                                        <div>
                                          <h4 className="font-medium text-yellow-800">
                                            JSON Parsing Error
                                          </h4>
                                          <p className="text-sm text-yellow-700 mt-1">
                                            {message.parsingError}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {message.latestFailure && (
                                    <>
                                      <div className="flex items-start gap-2 mb-2">
                                        <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                                        <div>
                                          <h4 className="font-medium">
                                            Latest Failure Details
                                          </h4>
                                          <p className="text-sm text-muted-foreground mb-2">
                                            {formatDate(
                                              message.latestFailure.createdAt
                                            )}{' '}
                                            (
                                            {getTimeAgo(
                                              message.latestFailure.createdAt
                                            )}
                                            )
                                          </p>
                                        </div>
                                      </div>

                                      <div className="grid gap-4 md:grid-cols-2">
                                        <div>
                                          <h5 className="text-sm font-medium mb-1">
                                            Result Code
                                          </h5>
                                          <Badge
                                            variant={
                                              message.latestFailure
                                                .resultCode >= 500
                                                ? 'destructive'
                                                : 'outline'
                                            }
                                            className="text-sm">
                                            {message.latestFailure.resultCode}
                                          </Badge>
                                          {message.largePayloadFailure && (
                                            <Badge
                                              variant="outline"
                                              className="ml-2 bg-amber-100 text-amber-800">
                                              Large Payload
                                            </Badge>
                                          )}
                                        </div>

                                        {message.latestFailure
                                          .failureReason && (
                                          <div>
                                            <h5 className="text-sm font-medium mb-1">
                                              Failure Reason
                                            </h5>
                                            <p className="text-sm">
                                              {
                                                message.latestFailure
                                                  .failureReason
                                              }
                                            </p>
                                            {message.largePayloadFailure && (
                                              <p className="text-sm mt-1 text-amber-600">
                                                The webhook payload was too
                                                large to process.
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {message.latestFailure.resultBody && (
                                        <div className="mt-4">
                                          <h5 className="text-sm font-medium mb-1">
                                            Response Body
                                          </h5>
                                          {formatResultBody(
                                            message.latestFailure.resultBody
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {!message.latestFailure &&
                                    !message.parsingError && (
                                      <div className="text-center py-4 text-muted-foreground">
                                        No additional details available for this
                                        message.
                                      </div>
                                    )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))
                    )}
                    {loadingState === LoadingState.LOADING_FULL && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-2">
                          <div className="flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
                            <div className="flex items-center">
                              <RefreshCw className="h-3 w-3 animate-spin mr-2" />
                              Loading data in batches... ({loadingProgress} of{' '}
                              {totalItems})
                            </div>
                            {totalItems > 0 && (
                              <div className="w-full max-w-md h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-in-out"
                                  style={{
                                    width: `${
                                      (loadingProgress / totalItems) * 100
                                    }%`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show</span>
                  <Select
                    value={itemsPerPage.toString()}
                    onValueChange={(value) => {
                      setItemsPerPage(Number.parseInt(value));
                      setCurrentPage(1); // Reset to first page when changing items per page
                    }}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    per page
                  </span>
                </div>

                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1}-{endIndex} of {sortedMessages.length}{' '}
                  messages
                </div>

                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() =>
                          setCurrentPage((prev) => Math.max(prev - 1, 1))
                        }
                        className={
                          currentPage === 1
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>

                    {getPageNumbers().map((page, index) => (
                      <PaginationItem key={index}>
                        {page === 'ellipsis-start' ||
                        page === 'ellipsis-end' ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            isActive={page === currentPage}
                            onClick={() =>
                              typeof page === 'number' && setCurrentPage(page)
                            }
                            className={
                              typeof page === 'number' ? 'cursor-pointer' : ''
                            }>
                            {page}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() =>
                          setCurrentPage((prev) =>
                            Math.min(prev + 1, totalPages)
                          )
                        }
                        className={
                          currentPage === totalPages
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}

          {/* Add a notification about data timeframe */}
          {loadingState === LoadingState.COMPLETE && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>
                  Only showing webhook data from the last 12 hours due to API
                  performance limitations. Results are limited to recent data to
                  prevent timeouts.
                </span>
              </div>
            </div>
          )}

          {/* Load More button */}
          {loadingState === LoadingState.COMPLETE && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={
                  isLoadingMore || messages.length === 0 || !hasOlderData
                }
                className="gap-2">
                {isLoadingMore && (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                )}
                {isLoadingMore
                  ? 'Loading older data...'
                  : !hasOlderData && messages.length > 0
                  ? 'No more data available'
                  : 'Load older data'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
