<?php
/**
 * Pure selection logic for the deploy coalescer, split out so it can be tested
 * against fixtures without touching the live deployment queue.
 */

use Illuminate\Support\Collection;

/**
 * Decide which queued deployments to retire.
 *
 * Input is the set of QUEUED, non-rollback deployments. In-progress rows must not
 * be passed in -- a running build is never superseded.
 *
 * Returns one entry per (application, pull_request_id) that has more than one
 * queued deployment: the newest is kept, every older one is superseded.
 *
 * @return array<int, array{keep: mixed, supersede: Collection}>
 */
function deploy_coalescer_plan(Collection $queued): array
{
    $plan = [];

    foreach ($queued->groupBy(fn ($d) => $d->application_id.'|'.$d->pull_request_id) as $group) {
        if ($group->count() < 2) {
            continue;
        }

        // Oldest -> newest. The last one is the version we actually want live.
        $ordered = $group->sortBy([['created_at', 'asc'], ['id', 'asc']])->values();

        $plan[] = [
            'keep' => $ordered->last(),
            'supersede' => $ordered->slice(0, $ordered->count() - 1),
        ];
    }

    return $plan;
}
