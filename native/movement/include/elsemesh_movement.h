#ifndef ELSEMESH_MOVEMENT_H
#define ELSEMESH_MOVEMENT_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Shared walkable-support query over normalized collision data.
 *
 * Boxes use 11 doubles per record:
 *   center xyz, half extents xyz, cos(yaw), sin(yaw), horizontal radius,
 *   top y, walkable flag.
 * Convexes use 8 doubles per record:
 *   bounds min xyz, bounds max xyz, first triangle, triangle count.
 * Triangles use 13 doubles per record:
 *   vertex a xyz, vertex b xyz, vertex c xyz, outward normal xyz, plane distance.
 * Heightfields use 15 doubles per record:
 *   position xyz, scale xyz, cos(yaw), sin(yaw), columns, rows, local min x/z,
 *   local grid step x/z, first sample in the heights array.
 * Queries use 6 doubles per record:
 *   x, z, maximum permitted support y, xz padding, minimum walkable normal y,
 *   capsule support radius.
 *
 * Return 1 on success, 0 for invalid pointers or counts. A successful query
 * with no support writes negative infinity, matching the engine's current API.
 */
int em_movement_support_height_batch(
	const double *boxes, size_t box_count,
	const double *convexes, size_t convex_count,
	const double *triangles, size_t triangle_count,
	const double *heightfields, size_t heightfield_count,
	const double *heights,
	const double *queries, size_t query_count,
	double *results);

#ifdef __cplusplus
}
#endif

#endif
