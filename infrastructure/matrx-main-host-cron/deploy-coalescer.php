<?php
/**
 * Deploy coalescer -- collapses superseded builds in the Coolify deployment queue.
 *
 * Coolify queues one row per (app, commit) and drains oldest-first, so a burst of
 * pushes builds every intermediate commit before reaching the newest one. With
 * concurrent_builds=1 and 4-5 apps rebuilt per push, a few rapid pushes create a
 * backlog that takes days to drain and delays the only version anyone wants.
 *
 * Per (application, pull_request_id) this keeps the newest queued deployment and
 * cancels the older queued ones as superseded. An in-progress build is NEVER
 * touched -- it runs to completion. Rollbacks are never superseded (they are a
 * deliberate "make THIS version live" action).
 *
 * Runs inside the Coolify container against Coolify's own models and helpers.
 * DRY_RUN=1 prints what it would do without writing.
 */

require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

require __DIR__.'/deploy-coalescer-lib.php';

use App\Enums\ApplicationDeploymentStatus as Status;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Server;

$dryRun = getenv('DRY_RUN') === '1';
$prefix = $dryRun ? '[dry-run] ' : '';

$queued = ApplicationDeploymentQueue::query()
    ->where('status', Status::QUEUED->value)
    ->where('rollback', false)
    ->get();

$plan = deploy_coalescer_plan($queued);

$supersededCount = 0;
$touchedServers = [];

foreach ($plan as $group) {
    $keep = $group['keep'];

    foreach ($group['supersede'] as $old) {
        printf(
            "%ssupersede: %-20s #%-5d commit=%s  (superseded by %s)\n",
            $prefix,
            $old->application_name,
            $old->id,
            substr((string) $old->commit, 0, 7),
            substr((string) $keep->commit, 0, 7)
        );

        if (! $dryRun) {
            // The row is QUEUED, so no ApplicationDeploymentJob has been dispatched for
            // it yet -- Coolify only dispatches on dequeue. Flipping the status is
            // therefore sufficient to retire it; nothing is left running.
            $old->update([
                'status' => Status::CANCELLED_BY_USER->value,
                'finished_at' => now(),
            ]);
        }

        $supersededCount++;
        $touchedServers[$old->server_id] = true;
    }

    printf(
        "%skeep:      %-20s #%-5d commit=%s\n",
        $prefix,
        $keep->application_name,
        $keep->id,
        substr((string) $keep->commit, 0, 7)
    );
}

if ($supersededCount === 0) {
    echo "nothing to coalesce\n";
    exit(0);
}

// ---------------------------------------------------------------------------
// AI Dream priority during a rapid-fire round.
//
// We only reach here when something was superseded this run -- i.e. a NEW push
// arrived while builds from a previous round were still queued/building. That
// burst pattern is ALWAYS a production incident: a bug is live and aidream must
// come back FIRST; the other apps wait. So we pull ai-dream-server's kept row to
// the front of the queue. An in-progress build is never touched -- it finishes,
// then aidream is next to dequeue (Coolify drains queued rows by created_at asc).
//
// On an idle single push nothing is superseded, this block never runs, and
// aidream keeps its natural order -- exactly as intended.
// ---------------------------------------------------------------------------
$aidreamQueued = ApplicationDeploymentQueue::query()
    ->where('status', Status::QUEUED->value)
    ->where('application_name', 'ai-dream-server')
    ->where('rollback', false)
    ->orderBy('created_at')
    ->get();

if ($aidreamQueued->isNotEmpty()) {
    $earliest = ApplicationDeploymentQueue::query()
        ->where('status', Status::QUEUED->value)
        ->min('created_at');
    $target = \Illuminate\Support\Carbon::parse($earliest)->subSeconds(5);

    foreach ($aidreamQueued as $row) {
        printf(
            "%sprioritize: ai-dream-server #%-5d -> front of queue (%s)\n",
            $prefix,
            $row->id,
            $target->toDateTimeString()
        );
        if (! $dryRun) {
            // created_at is the ONLY drain-order key (verified in bootstrap/helpers/
            // applications.php). Data-only + self-correcting: the next push writes
            // fresh rows, so this never accumulates.
            $row->update(['created_at' => $target]);
        }
        $target = $target->copy()->subSecond(); // keep multiple aidream rows ordered
    }
}

// Cancelling queued rows / reordering does not itself advance the queue. Nudge each
// affected server so a freed build slot picks the (now aidream-first) queue up
// immediately. next_queuable() still enforces concurrent_builds, so this cannot
// over-dispatch, and it never interrupts an in-progress build.
if (! $dryRun) {
    foreach (array_keys($touchedServers) as $serverId) {
        if ($server = Server::find($serverId)) {
            next_after_cancel($server);
        }
    }
}

printf("%ssuperseded %d queued deployment(s)\n", $prefix, $supersededCount);
