export type BuildInfo = {
  current_image: { id: string | null; created: string | null; age: string | null };
  source: { path: string; branch: string; head_commit: string; last_build_commit: string | null };
  has_changes: boolean;
  pending_commits: string[];
  diff_stats: string | null;
  instances: Array<{ name: string; display_name: string; status: string }>;
  available_tags: Array<{ tag: string; id: string; age: string }>;
  last_build: { tag: string; timestamp: string; git_commit: string; duration_ms: number } | null;
};

export type BuildRecord = {
  id: string;
  tag: string;
  timestamp: string;
  git_commit: string;
  git_message: string;
  image_id: string | null;
  success: boolean;
  error: string | null;
  duration_ms: number;
  triggered_by: string;
  instances_restarted: string[];
};

export type SystemInfo = {
  hostname: string;
  cpus: number;
  memory: { total: string; used: string; percent: string };
  disk: { total: string; used: string; percent: string };
  uptime_hours: string;
  docker: string;
  containers: string[];
};
