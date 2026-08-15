# Website Cursor Trajectories

Trajectory collection belongs to the experiment website, not to a particular
human device or agent browser controller. Human and agent sessions use the
same task renderer, trial timeline, save API, recovery storage, and download
fallback.

## What the website records

During testing trials only, each task renderer uses browser `pointermove`
events to collect cursor positions:

```text
center-cross click → begin recording
first candidate response → stop recording
```

Each `TrajectoryPoint` has a trial ID, ordered sample index, timestamp,
elapsed time from the cross click, raw viewport coordinates, and normalized
coordinates. Training trials do not contribute result or trajectory records.

The visual-similarity and object-matching renderers both add the collected
points to the same session payload that records responses. No agent-specific
interpolation, trace-step URL parameter, or browser-automation library is
used by the website.

## Saving and manual downloads

On completion, the website sends the complete session payload to:

```text
POST /api/experiments/sessions
```

If the API does not respond successfully after retrying, the same completion
page shown to humans and agents exposes two buttons:

```text
Download results
Download trajectories
```

Those downloads contain the current session's response records and testing
trajectory records. Movement on the completion/download page cannot be added
to a trial trajectory because the trial listener is removed at the first
response.

## External agent workers

An external worker may use any browser-control technology, but the model must
receive only public screenshot information and issue restricted public actions.
The website needs only normal browser pointer events; if a worker produces
multiple pointer movements between the cross and the response, they are
recorded just as human movements are. Future worker implementation is separate
from this website codebase.
