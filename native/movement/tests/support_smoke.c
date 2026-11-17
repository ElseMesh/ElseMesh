#include "elsemesh_movement.h"

#include <math.h>
#include <stdio.h>

static int near(double actual, double expected) {
	return isfinite(actual) && fabs(actual - expected) < 1e-9;
}

int main(void) {
	const double boxes[] = {
		0.0, 1.0, 0.0, 1.0, 0.5, 1.0, 1.0, 0.0, 1.4142135623730951, 1.5, 1.0
	};
	const double convexes[] = { 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0 };
	const double triangles[] = {
		0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0,
		-0.7071067811865476, 0.7071067811865476, 0.0, 0.0
	};
	const double heightfields[] = {
		0.0, 1.0, 0.0, 1.0, 2.0, 1.0, 1.0, 0.0, 2.0, 2.0, 0.0, 0.0, 1.0, 1.0, 0.0
	};
	const double heights[] = { 0.0, 1.0, 0.0, 1.0 };
	const double queries[] = {
		0.0, 0.0, 2.0, 0.0, 0.8, 0.0,
		0.25, 0.25, 0.5, 0.0, 0.5, 0.0,
		0.5, 0.5, 5.0, 0.0, 0.8, 0.0,
		8.0, 8.0, 5.0, 0.0, 0.8, 0.0
	};
	double results[4];
	if (!em_movement_support_height_batch(boxes, 1, convexes, 1, triangles, 1,
			heightfields, 1, heights, queries, 4, results)) {
		fputs("support query rejected valid inputs\n", stderr);
		return 1;
	}
	if (!near(results[0], 1.5) || !near(results[1], 0.25) || !near(results[2], 2.0)
			|| !isinf(results[3]) || results[3] > 0.0) {
		fprintf(stderr, "unexpected support results: %.12g %.12g %.12g %.12g\n",
			results[0], results[1], results[2], results[3]);
		return 1;
	}
	if (em_movement_support_height_batch(NULL, 1, convexes, 1, triangles, 1,
			heightfields, 1, heights, queries, 4, results)) {
		fputs("support query accepted a missing non-empty box buffer\n", stderr);
		return 1;
	}
	puts("ok shared box, convex-triangle, heightfield, and unknown-support results");
	return 0;
}
