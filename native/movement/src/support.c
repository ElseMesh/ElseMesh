#include "elsemesh_movement.h"

enum {
	BOX_STRIDE = 11,
	CONVEX_STRIDE = 8,
	TRIANGLE_STRIDE = 13,
	HEIGHTFIELD_STRIDE = 15,
	QUERY_STRIDE = 6
};

/* Keep this kernel usable by freestanding WebAssembly builds without a WASI
 * sysroot. Grid coordinates are clamped nonnegative before integer conversion,
 * which therefore has the required floor behavior. */
static double absolute(double value) { return value < 0.0 ? -value : value; }
static double minimum(double a, double b) { return a < b ? a : b; }
static double maximum(double a, double b) { return a > b ? a : b; }

static double closest_segment_xz(double x, double z, const double *a, const double *b,
		double *closest_x, double *closest_z) {
	const double dx = b[0] - a[0];
	const double dz = b[2] - a[2];
	const double length_squared = dx * dx + dz * dz;
	const double projection = length_squared > 1e-12
		? maximum(0.0, minimum(1.0, ((x - a[0]) * dx + (z - a[2]) * dz) / length_squared))
		: 0.0;
	*closest_x = a[0] + projection * dx;
	*closest_z = a[2] + projection * dz;
	const double qx = x - *closest_x;
	const double qz = z - *closest_z;
	return qx * qx + qz * qz;
}

static double closest_triangle_xz(double x, double z, const double *triangle,
		double *closest_x, double *closest_z) {
	const double *a = triangle;
	const double *b = triangle + 3;
	const double *c = triangle + 6;
	const double ab_x = b[0] - a[0];
	const double ab_z = b[2] - a[2];
	const double ac_x = c[0] - a[0];
	const double ac_z = c[2] - a[2];
	const double ap_x = x - a[0];
	const double ap_z = z - a[2];
	const double d00 = ab_x * ab_x + ab_z * ab_z;
	const double d01 = ab_x * ac_x + ab_z * ac_z;
	const double d11 = ac_x * ac_x + ac_z * ac_z;
	const double d20 = ap_x * ab_x + ap_z * ab_z;
	const double d21 = ap_x * ac_x + ap_z * ac_z;
	const double denominator = d00 * d11 - d01 * d01;

	if (absolute(denominator) > 1e-12) {
		const double v = (d11 * d20 - d01 * d21) / denominator;
		const double w = (d00 * d21 - d01 * d20) / denominator;
		const double u = 1.0 - v - w;
		if (u >= 0.0 && v >= 0.0 && w >= 0.0) {
			*closest_x = x;
			*closest_z = z;
			return 0.0;
		}
	}

	double ab_x_closest, ab_z_closest, bc_x_closest, bc_z_closest, ca_x_closest, ca_z_closest;
	const double ab_distance = closest_segment_xz(x, z, a, b, &ab_x_closest, &ab_z_closest);
	const double bc_distance = closest_segment_xz(x, z, b, c, &bc_x_closest, &bc_z_closest);
	const double ca_distance = closest_segment_xz(x, z, c, a, &ca_x_closest, &ca_z_closest);
	if (ab_distance <= bc_distance && ab_distance <= ca_distance) {
		*closest_x = ab_x_closest;
		*closest_z = ab_z_closest;
		return ab_distance;
	}
	if (bc_distance <= ca_distance) {
		*closest_x = bc_x_closest;
		*closest_z = bc_z_closest;
		return bc_distance;
	}
	*closest_x = ca_x_closest;
	*closest_z = ca_z_closest;
	return ca_distance;
}

static double support_height(const double *boxes, size_t box_count,
		const double *convexes, size_t convex_count,
		const double *triangles,
		const double *heightfields, size_t heightfield_count,
		const double *heights, const double *query) {
	const double x = query[0];
	const double z = query[1];
	const double max_y = query[2];
	const double pad = query[3];
	const double min_normal_y = query[4];
	const double capsule_radius = query[5];
	double best = -__builtin_inf();

	for (size_t i = 0; i < box_count; ++i) {
		const double *box = boxes + i * BOX_STRIDE;
		if (box[10] == 0.0 || box[9] > max_y) continue;
		if (absolute(x - box[0]) > box[8] + pad + 0.01
				|| absolute(z - box[2]) > box[8] + pad + 0.01) continue;
		const double dx = x - box[0];
		const double dz = z - box[2];
		const double local_x = dx * box[6] - dz * box[7];
		const double local_z = dx * box[7] + dz * box[6];
		if (absolute(local_x) <= box[3] + pad && absolute(local_z) <= box[5] + pad)
			best = maximum(best, box[9]);
	}

	const double capsule_radius_squared = capsule_radius * capsule_radius;
	for (size_t i = 0; i < convex_count; ++i) {
		const double *convex = convexes + i * CONVEX_STRIDE;
		if (convex[1] > max_y || x < convex[0] - pad - capsule_radius
				|| x > convex[3] + pad + capsule_radius
				|| z < convex[2] - pad - capsule_radius
				|| z > convex[5] + pad + capsule_radius) continue;
		const size_t first_triangle = (size_t)convex[6];
		const size_t count = (size_t)convex[7];
		for (size_t j = 0; j < count; ++j) {
			const double *triangle = triangles + (first_triangle + j) * TRIANGLE_STRIDE;
			const double normal_y = triangle[10];
			if (normal_y < min_normal_y || normal_y <= 0.0) continue;
			double closest_x, closest_z;
			const double distance_squared = closest_triangle_xz(x, z, triangle, &closest_x, &closest_z);
			if (distance_squared > capsule_radius_squared + 1e-12) continue;
			const double surface_height = (triangle[12] - triangle[9] * closest_x - triangle[11] * closest_z) / normal_y;
			const double capsule_support_height = surface_height + capsule_radius * (1.0 / normal_y - 1.0);
			if (capsule_support_height <= max_y) best = maximum(best, capsule_support_height);
		}
	}

	for (size_t i = 0; i < heightfield_count; ++i) {
		const double *field = heightfields + i * HEIGHTFIELD_STRIDE;
		const double dx = x - field[0];
		const double dz = z - field[2];
		const double local_x = (dx * field[6] - dz * field[7]) / field[3];
		const double local_z = (dx * field[7] + dz * field[6]) / field[5];
		const double columns = field[8];
		const double rows = field[9];
		const double min_x = field[10];
		const double min_z = field[11];
		const double step_x = field[12];
		const double step_z = field[13];
		if (step_x <= 0.0 || step_z <= 0.0 || columns < 2.0 || rows < 2.0) continue;
		double column = (local_x - min_x) / step_x;
		double row = (local_z - min_z) / step_z;
		if (column < -pad / step_x || column > columns - 1.0 + pad / step_x
				|| row < -pad / step_z || row > rows - 1.0 + pad / step_z) continue;
		column = maximum(0.0, minimum(columns - 1.0, column));
		row = maximum(0.0, minimum(rows - 1.0, row));
		size_t x0 = (size_t)column;
		size_t z0 = (size_t)row;
		const size_t column_count = (size_t)columns;
		const size_t row_count = (size_t)rows;
		if (x0 >= column_count - 1) x0 = column_count - 2;
		if (z0 >= row_count - 1) z0 = row_count - 2;
		const double tx = column - (double)x0;
		const double tz = row - (double)z0;
		const size_t first = (size_t)field[14];
		const double h00 = heights[first + z0 * column_count + x0];
		const double h10 = heights[first + z0 * column_count + x0 + 1];
		const double h01 = heights[first + (z0 + 1) * column_count + x0];
		const double h11 = heights[first + (z0 + 1) * column_count + x0 + 1];
		const double h0 = h00 * (1.0 - tx) + h10 * tx;
		const double h1 = h01 * (1.0 - tx) + h11 * tx;
		const double world_height = field[1] + (h0 * (1.0 - tz) + h1 * tz) * field[4];
		if (world_height <= max_y) best = maximum(best, world_height);
	}

	return best;
}

int em_movement_support_height_batch(
		const double *boxes, size_t box_count,
		const double *convexes, size_t convex_count,
		const double *triangles, size_t triangle_count,
		const double *heightfields, size_t heightfield_count,
		const double *heights,
		const double *queries, size_t query_count,
		double *results) {
	if ((box_count && boxes == NULL) || (convex_count && convexes == NULL)
			|| (triangle_count && triangles == NULL) || (heightfield_count && heightfields == NULL)
			|| (heightfield_count && heights == NULL) || (query_count && (queries == NULL || results == NULL))) return 0;
	for (size_t i = 0; i < convex_count; ++i) {
		const double *convex = convexes + i * CONVEX_STRIDE;
		const size_t first = (size_t)convex[6];
		const size_t count = (size_t)convex[7];
		if (first > triangle_count || count > triangle_count - first) return 0;
	}
	for (size_t i = 0; i < heightfield_count; ++i) {
		const double *field = heightfields + i * HEIGHTFIELD_STRIDE;
		const size_t columns = (size_t)field[8];
		const size_t rows = (size_t)field[9];
		const size_t first = (size_t)field[14];
		const size_t size_max = (size_t)-1;
		if (columns < 2 || rows < 2 || columns > size_max / rows || first > size_max - columns * rows) return 0;
	}
	for (size_t i = 0; i < query_count; ++i)
		results[i] = support_height(boxes, box_count, convexes, convex_count, triangles,
			heightfields, heightfield_count, heights, queries + i * QUERY_STRIDE);
	return 1;
}
