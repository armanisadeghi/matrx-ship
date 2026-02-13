import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

interface TicketWidgetConfig {
    /** Base URL of the Matrx Ship instance (e.g., "https://myapp.example.com") */
    baseUrl: string;
    /** Reporter token for authentication */
    reporterToken?: string;
    /** Project identifier */
    projectId?: string;
    /** Reporter's unique identifier */
    reporterId?: string;
    /** Reporter display name */
    reporterName?: string;
    /** Reporter email */
    reporterEmail?: string;
    /** Default ticket type */
    defaultType?: "bug" | "feature" | "suggestion" | "task" | "enhancement";
    /** Theme: "light" | "dark" | "auto" (follows system) */
    theme?: "light" | "dark" | "auto";
    /** Custom CSS class name for the root container */
    className?: string;
    /** z-index for the floating button */
    zIndex?: number;
}
interface TicketSubmission {
    title: string;
    description: string;
    ticket_type: string;
    priority?: string;
    route?: string;
    browser_info?: string;
    os_info?: string;
    reporter_id?: string;
    reporter_name?: string;
    reporter_email?: string;
    project_id?: string;
    source?: string;
    client_reference_id?: string;
}
interface TicketResponse {
    id: string;
    ticket_number: number;
    title: string;
    status: string;
    created_at: string;
}
interface TimelineEntry {
    id: string;
    activityType: string;
    authorType: string;
    authorName: string | null;
    content: string | null;
    visibility: string;
    createdAt: string;
}

declare function useTicketConfig(): TicketWidgetConfig;
declare function TicketProvider({ config, children, }: {
    config: TicketWidgetConfig;
    children: ReactNode;
}): react_jsx_runtime.JSX.Element;

interface TicketButtonProps {
    /** Position of the floating button */
    position?: "bottom-right" | "bottom-left";
    /** Custom label text */
    label?: string;
    /** CSS class name for the button */
    className?: string;
}
declare function TicketButton({ position, label, className, }: TicketButtonProps): react_jsx_runtime.JSX.Element;

interface TicketFormProps {
    /** Called after successful submission */
    onSubmitted?: (ticket: TicketResponse) => void;
    /** Called on close/cancel */
    onClose?: () => void;
    /** Default ticket type */
    defaultType?: string;
    /** CSS class name */
    className?: string;
}
declare function TicketForm({ onSubmitted, onClose, defaultType, className, }: TicketFormProps): react_jsx_runtime.JSX.Element;

interface TicketTrackerProps {
    /** Ticket number (the T-XXX number) to track */
    ticketNumber: number;
    /** CSS class name */
    className?: string;
}
declare function TicketTracker({ ticketNumber, className }: TicketTrackerProps): react_jsx_runtime.JSX.Element | null;

/**
 * Auto-capture environment information from the browser.
 */
declare function captureEnvironment(): {
    browserInfo: string;
    osInfo: string;
    route: string;
};
/**
 * Generate an idempotent client reference ID.
 */
declare function generateClientRefId(): string;
/**
 * Make an API call to the Matrx Ship instance.
 */
declare function apiCall<T>(baseUrl: string, path: string, options?: {
    method?: string;
    body?: unknown;
    reporterToken?: string;
}): Promise<T>;

export { TicketButton, TicketForm, TicketProvider, type TicketResponse, type TicketSubmission, TicketTracker, type TicketWidgetConfig, type TimelineEntry, apiCall, captureEnvironment, generateClientRefId, useTicketConfig };
