# Repository Cleanup Design

## Goal

Make the merged repository easier to navigate while preserving experiment
records, keeping deployment assets separate from results, and reclaiming the
local disk space used by obsolete generated dataset duplicates.

The cleanup is non-functional: it must not change any human or agent task,
URL, renderer, response mapping, local-development behavior, or Firebase
Hosting behavior.

## Results Records

Keep experiment records under their current Git-tracked structure:

```text
results/
  response/<task>/
  trajectory/<task>/
  figure/<task>/
```

Add `results/README.md` documenting each directory, task/run filename
convention, and the distinction between response data, trajectories, and
derived figures. Results are research records and remain versioned in Git.

## Deployment Boundary

Only Vite's `public/` directory contributes static assets to `dist/`.
`results/`, source preparation scripts, development worktrees, and source
datasets must never be included in the deployed site. The build verification
will assert that no `dist/results` directory exists.

## Duplicate Dataset Removal

The canonical browser-deployable subsets are:

```text
public/data/dreamsim_100/
public/data/rs_imagenet_100/
```

Before deletion, compare each old ignored generated directory with its public
counterpart by relative filename and SHA-256 digest. Delete only when both
directory manifests match exactly:

```text
data/dreamsim_100/
data/rs_imagenet_100/
```

Never delete source datasets in `data/dreamsim/` or `data/rs_imagenet/`,
experiment records in `results/`, or an unmatched file. If comparison fails,
leave both directories intact and report the difference.

The verified old generated directories contain only three macOS metadata files
and no datasets: `data/dreamsim_100/.DS_Store`,
`data/dreamsim_100/distort/.DS_Store`, and
`data/rs_imagenet_100/.DS_Store`. Remove only these files and their now-empty
directories.

## Local Development Hygiene

Add `.worktrees/` to `.gitignore` so isolated Git worktrees are not shown as
untracked repository content. Preserve all existing uncommitted renderer,
test, and documentation changes; this cleanup must not stage, move, or alter
them.

The merged and clean `feat/portable-deployment` worktree at
`.worktrees/portable-deployment` is obsolete. Remove it using `git worktree
remove` before running the final local test suite, so Vitest does not discover
and execute a second checkout's tests.

## Verification

Add tests or build checks confirming `results/` is absent from `dist`, existing
task tests still pass, and the two public manifests exist after build. Record
the pre-deletion checksum comparison in a non-versioned command log or report;
do not commit source-data hashes as a replacement for the research records.

Before deleting duplicates, run the current full test suite and production
build. After deletion, run the same full test suite and build again, then
verify that `dist` contains both public task manifests and no `dist/results`
directory. Start the local Vite server and load both canonical task URLs to
confirm their instruction screens load without manifest errors. These checks
establish that Firebase Hosting continues to deploy the same `dist` output and
that local testing continues to use the same public asset URLs.
