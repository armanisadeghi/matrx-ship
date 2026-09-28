<?php
/**
 * Fixture tests for deploy_coalescer_plan(). Uses unsaved model instances -- nothing
 * is written to the deployment queue and nothing is dispatchable.
 */

require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

require __DIR__.'/deploy-coalescer-lib.php';

use App\Models\ApplicationDeploymentQueue;

$failures = 0;
$id = 1;

function row(int $id, string $appId, string $commit, string $createdAt, int $pr = 0)
{
    $d = new ApplicationDeploymentQueue([
        'application_id' => $appId,
        'application_name' => 'app-'.$appId,
        'commit' => $commit,
        'pull_request_id' => $pr,
        'server_id' => 0,
    ]);
    $d->id = $id;
    $d->created_at = $createdAt;

    return $d;
}

function check(string $name, bool $ok)
{
    global $failures;
    if (! $ok) {
        $failures++;
    }
    printf("  [%s] %s\n", $ok ? 'PASS' : 'FAIL', $name);
}

// ---------------------------------------------------------------------------
echo "\nArman's burst: 6 pushes, each fanning out to 4 apps, 1 build at a time.\n";
echo "(the in-progress build is not in this set -- it is never passed in)\n\n";

$apps = ['aidream', 'scraper', 'dashboard', 'studio'];
$queued = collect();
foreach (range(1, 6) as $push) {
    foreach ($apps as $a) {
        $queued->push(row($id++, $a, sprintf('v1.7%d', $push), sprintf('2026-07-11 20:%02d:00', $push)));
    }
}

check('24 deployments queued from 6 pushes', $queued->count() === 24);

$plan = deploy_coalescer_plan($queued);

check('one decision per app (4)', count($plan) === 4);

$kept = collect($plan)->map(fn ($g) => $g['keep']);
$superseded = collect($plan)->flatMap(fn ($g) => $g['supersede']);

check('keeps exactly 4 builds -- the newest per app', $kept->count() === 4);
check('every kept build is the newest commit (v1.76)', $kept->every(fn ($d) => $d->commit === 'v1.76'));
check('supersedes the other 20', $superseded->count() === 20);
check('nothing at v1.76 is superseded', $superseded->every(fn ($d) => $d->commit !== 'v1.76'));
check('each app kept exactly once', $kept->pluck('application_id')->unique()->count() === 4);

printf("\n  => 24 queued builds collapse to 4. Backlog drained in 4 builds, not 24.\n");

// ---------------------------------------------------------------------------
echo "\nEdge cases\n\n";

// A single queued build must be left completely alone.
$plan = deploy_coalescer_plan(collect([row(1, 'aidream', 'v1.71', '2026-07-11 20:01:00')]));
check('single queued build is never superseded', count($plan) === 0);

// Nothing queued at all.
check('empty queue is a no-op', count(deploy_coalescer_plan(collect())) === 0);

// PR previews must not clobber the main-branch deployment for the same app.
$plan = deploy_coalescer_plan(collect([
    row(1, 'aidream', 'main-a', '2026-07-11 20:01:00', 0),
    row(2, 'aidream', 'main-b', '2026-07-11 20:02:00', 0),
    row(3, 'aidream', 'pr-a', '2026-07-11 20:01:00', 42),
    row(4, 'aidream', 'pr-b', '2026-07-11 20:02:00', 42),
]));
check('main and PR#42 are coalesced independently', count($plan) === 2);
$kept = collect($plan)->map(fn ($g) => $g['keep'])->pluck('commit')->sort()->values()->all();
check('newest of each stream survives (main-b, pr-b)', $kept === ['main-b', 'pr-b']);

// Same timestamp (a fan-out burst lands within the same second) -- id breaks the tie.
$plan = deploy_coalescer_plan(collect([
    row(10, 'aidream', 'older', '2026-07-11 20:01:00'),
    row(11, 'aidream', 'newer', '2026-07-11 20:01:00'),
]));
check('identical timestamps tie-break on id (highest wins)', $plan[0]['keep']->commit === 'newer');

// ---------------------------------------------------------------------------
echo "\n";
if ($failures > 0) {
    printf("%d check(s) FAILED\n", $failures);
    exit(1);
}
echo "all checks passed\n";
