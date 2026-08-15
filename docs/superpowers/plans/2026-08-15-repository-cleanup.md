# Repository Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove verified stale local metadata and the merged worktree while preserving results, local tests, and Firebase deployment output.

**Architecture:** public/data remains the sole browser/deployment data location. results remains Git-tracked research data and is excluded from Vite output. Cleanup occurs only after pre-cleanup tests, build checks, and exact-path verification.

**Tech Stack:** Git worktrees, Vite, Vitest, TypeScript.

## Global Constraints

- Preserve all uncommitted renderer, test, and documentation edits.
- Preserve every file under results.
- Never remove data/dreamsim or data/rs_imagenet.
- Do not change task URLs, behavior, local Vite behavior, or Firebase Hosting output.
- Remove only the verified .DS_Store files, empty legacy subset directories, and the merged clean portable-deployment worktree.

---

### Task 1: Prove cleanup safety before mutation

**Files:** Read .gitignore, vite.config.ts, data, public/data, results.

- [ ] **Step 1: Verify worktree merge and cleanliness**

Run:

    git worktree list
    git status --short .worktrees/portable-deployment
    git merge-base --is-ancestor feat/portable-deployment master

Expected: worktree is clean and its branch is merged into master.

- [ ] **Step 2: Verify exactly removable paths**

Run:

    find data/dreamsim_100 data/rs_imagenet_100 -type f -print | sort
    find public/data/dreamsim_100 public/data/rs_imagenet_100 -type f | wc -l

Expected: old paths contain only data/dreamsim_100/.DS_Store, data/dreamsim_100/distort/.DS_Store, and data/rs_imagenet_100/.DS_Store; public paths contain canonical assets.

- [ ] **Step 3: Run pre-cleanup deployment checks**

Run:

    npm test
    npm run build
    test -f dist/data/dreamsim_100/data_100_web.csv
    test -f dist/data/rs_imagenet_100/data_web_100.csv
    test ! -e dist/results

Expected: tests/build pass; both manifests exist; results is absent from dist.

### Task 2: Apply minimal cleanup with a regression test

**Files:** Modify .gitignore. Create results/README.md and tasks/shared/app/results-layout.test.ts. Remove only verified local paths.

- [ ] **Step 1: Write failing results-layout test**

Create tasks/shared/app/results-layout.test.ts with a test that reads results/README.md, expects it to exist, and expects its text to contain response/<task>, trajectory/<task>, and figure/<task>.

- [ ] **Step 2: Verify test fails**

Run: npm test -- tasks/shared/app/results-layout.test.ts

Expected: FAIL because results/README.md does not exist.

- [ ] **Step 3: Add documentation and ignore rule**

Add .worktrees/ to .gitignore. Create results/README.md documenting response/<task> as complete trial JSON, trajectory/<task> as pointer JSON, figure/<task> as derived images, and that results remain in Git and never deploy in dist.

- [ ] **Step 4: Remove only verified obsolete paths**

Run:

    git worktree remove .worktrees/portable-deployment
    rm data/dreamsim_100/.DS_Store
    rm data/dreamsim_100/distort/.DS_Store
    rmdir data/dreamsim_100/distort
    rmdir data/dreamsim_100
    rm data/rs_imagenet_100/.DS_Store
    rmdir data/rs_imagenet_100

- [ ] **Step 5: Verify test passes and commit only cleanup files**

Run: npm test -- tasks/shared/app/results-layout.test.ts

Then commit only .gitignore, results/README.md, and tasks/shared/app/results-layout.test.ts with message chore: document results and ignore local worktrees.

### Task 3: Verify local and Firebase-deployable behavior

- [ ] **Step 1: Run full post-cleanup checks**

Run:

    npm test
    npm run build
    test -f dist/data/dreamsim_100/data_100_web.csv
    test -f dist/data/rs_imagenet_100/data_web_100.csv
    test ! -e dist/results
    git status --short

Expected: tests/build pass; output still has both manifests and no results; active edits/results remain untouched.

- [ ] **Step 2: Smoke-test both local URLs**

Start npm run dev -- --host 127.0.0.1 and open the visual-similarity and object-matching development URLs. Confirm both instruction screens load without manifest errors, then stop Vite.

- [ ] **Step 3: Report exact evidence**

Report test/build output, removed paths, and confirmation that Firebase continues to deploy the same dist directory.
