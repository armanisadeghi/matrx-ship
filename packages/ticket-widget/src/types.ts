export interface TicketWidgetConfig {
  /** Base URL of the Matrx Ship instance (e.g., "https://ship-myapp.example.com") */
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

export interface TicketSubmission {
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

export interface TicketResponse {
  id: string;
  ticket_number: number;
  title: string;
  status: string;
  created_at: string;
}

export interface TimelineEntry {
  id: string;
  activityType: string;
  authorType: string;
  authorName: string | null;
  content: string | null;
  visibility: string;
  createdAt: string;
}
