/* Woven picture: a tiny ray tracer on a 112x63 thread grid, drawn as gold threads. */
(function () {
  'use strict';
  var canvas = document.getElementById('weave');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var loom = canvas.closest('.loom') || canvas.parentElement;
  var GOLD = '#d9aa3e';
  var COLS = 112, ROWS = 63, CELL = 10, THREAD = 9;
  var CAM = [0.9, 1.35, -4.3], TARGET = [-0.45, 0.85, 0], HALF_FOV = 0.6;
  var DEFAULT_LIGHT = norm([-0.9, 1.1, -0.5]);
  var light = DEFAULT_LIGHT.slice();
  // camera basis: forward at TARGET, right, up (u = f x r points up)
  var F = norm(sub(TARGET, CAM));
  var R = norm([F[2], 0, -F[0]]);
  var U = [F[1] * R[2] - F[2] * R[1], F[2] * R[0] - F[0] * R[2], F[0] * R[1] - F[1] * R[0]];
  var BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  function norm(v) {
    var l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }

  // Photo knock-out rect in canvas backing pixels (measured, so it mirrors for free).
  function knockOut() {
    var cr = canvas.getBoundingClientRect();
    var pr = loom.querySelector('.photo');
    if (!pr || !cr.width) return null;
    var r = pr.getBoundingClientRect();
    var s = canvas.width / cr.width;
    return {
      x0: (r.left - cr.left) * s,
      x1: (r.right - cr.left) * s,
      y0: (r.top - cr.top) * s,
      y1: (r.bottom - cr.top) * s
    };
  }

  function shadeRay(px, py, L) {
    var sx = (px / COLS * 2 - 1) * HALF_FOV * (COLS / ROWS);
    var sy = (1 - py / ROWS * 2) * HALF_FOV;
    var dir = norm([
      F[0] + sx * R[0] + sy * U[0],
      F[1] + sx * R[1] + sy * U[1],
      F[2] + sx * R[2] + sy * U[2]
    ]);

    // sphere at (0,1,0) r=1
    var oc = sub(CAM, [0, 1, 0]);
    var b = dot(oc, dir);
    var c = dot(oc, oc) - 1;
    var disc = b * b - c;
    var tS = disc > 0 ? -b - Math.sqrt(disc) : Infinity;

    // plane y=0
    var tP = dir[1] < -1e-6 ? -CAM[1] / dir[1] : Infinity;
    var t = Math.min(tS, tP);
    if (t === Infinity) return Math.max(0, 0.42 - 1.1 * dir[1]); // sky

    var p = [CAM[0] + dir[0] * t, CAM[1] + dir[1] * t, CAM[2] + dir[2] * t];
    var v;
    if (tS <= tP) {
      var n = norm(sub(p, [0, 1, 0]));
      var h = norm([L[0] - dir[0], L[1] - dir[1], L[2] - dir[2]]);
      var spec = Math.max(0, dot(n, h));
      // sky ambient plus warm bounce from the gold floor keeps the dark side apart from the cast shadow
      return 0.1 + 0.07 * (1 - n[1]) + 0.95 * Math.pow(Math.max(0, dot(n, L)), 0.8) + 0.6 * Math.pow(spec, 25);
    }
    var so = sub(p, [0, 1, 0]);
    var d = len(so);
    // shadow: does the ray from p toward the light hit the sphere?
    var sb = dot(so, L);
    var shadowed = sb < 0 && sb * sb - (dot(so, so) - 1) > 0;
    var ao = 1 - 0.95 / (d * d + 0.15);
    return 0.78 * (shadowed ? 0.08 : 1) * ao * Math.max(0.35, 1 - t / 20);
  }

  function drawRow(y, ko) {
    for (var x = 0; x < COLS; x++) {
      var px = x * CELL + CELL / 2, py = y * CELL + CELL / 2;
      if (ko && px >= ko.x0 && px <= ko.x1 && py >= ko.y0 && py <= ko.y1) continue;
      if (shadeRay(x, y, light) * 16 > BAYER[y & 3][x & 3] + 0.5) {
        ctx.fillRect(x * CELL + 0.5, y * CELL + 0.5, THREAD, THREAD);
      }
    }
  }

  function draw() {
    var ko = knockOut();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = GOLD;
    for (var y = 0; y < ROWS; y++) drawRow(y, ko);
  }

  // redraw at most once per frame
  var pending = false;
  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; draw(); });
  }

  // re-measure the photo knock-out on resize
  addEventListener('resize', requestDraw);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(); return; }

  // weave in: 2 rows per frame
  var row = 0, ko0 = knockOut();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = GOLD;
  (function weaveRows() {
    for (var n = 0; n < 2 && row < ROWS; n++, row++) drawRow(row, ko0);
    if (row < ROWS) requestAnimationFrame(weaveRows);
  })();

  // The lamp chases the pointer at a capped speed, so entering, fast moves and
  // leaving all ease; it never snaps. Leaving walks it home to the resting light.
  var target = light.slice();
  var chasing = false;
  var lastT = 0;
  var MAX_SPEED = 2.0; // light-vector units per second

  function lightAt(e) {
    var r = loom.getBoundingClientRect();
    var cx = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    var cy = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
    // pointer low = lamp low and near the viewer, so its shadow climbs away
    return norm([-1.2 + 2.4 * cx, 1.1 - 0.75 * cy, 1.1 - 2.0 * cy]);
  }

  function chase(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var d = sub(target, light);
    var dist = len(d);
    if (dist > 1e-4) {
      var k = Math.min(1, MAX_SPEED * dt / dist);
      light = norm([light[0] + d[0] * k, light[1] + d[1] * k, light[2] + d[2] * k]);
    }
    draw();
    if (dist > 1e-3) requestAnimationFrame(chase);
    else chasing = false;
  }
  function requestChase() {
    if (chasing) return;
    chasing = true;
    lastT = performance.now();
    requestAnimationFrame(chase);
  }

  // test hook: read the live lamp direction (kept tiny; used by the build checks)
  window.__loomLight = function () { return light.slice(); };

  loom.addEventListener('pointerenter', function (e) { target = lightAt(e); requestChase(); });
  loom.addEventListener('pointermove', function (e) { target = lightAt(e); requestChase(); });
  loom.addEventListener('pointerleave', function () { target = DEFAULT_LIGHT.slice(); requestChase(); });
})();
