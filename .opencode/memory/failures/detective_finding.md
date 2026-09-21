# Failure: frontend update() aborted by push to missing history key
Symptom: charts animated but all numeric readouts frozen and 3D rocket static.
Root cause: frontend/app.js update() called push('velocity') but the history store had no velocity array -> TypeError on every packet, aborting update() after chart pushes but before numeric DOM writes and updateRocket(). Silent: no global error handler, freeze overlay stays hidden.
Lesson: order of writes in a single update path is load-bearing; guard shared sinks (push) the same way readers (drawChart filter) already do; one synthetic packet through update() in CI catches it.
Fix direction: add velocity: [] to history and/or guard push(); regression-test update() end to end.
