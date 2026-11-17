cmake_minimum_required(VERSION 3.20)
project(elsemesh_movement LANGUAGES C)

add_library(elsemesh_movement SHARED src/support.c)
target_compile_features(elsemesh_movement PRIVATE c_std_11)
target_include_directories(elsemesh_movement PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
set_target_properties(elsemesh_movement PROPERTIES OUTPUT_NAME elsemesh_movement)
if(UNIX)
	target_link_libraries(elsemesh_movement PRIVATE m)
endif()

find_program(ELSEMESH_WASM_CLANG clang)
if(ELSEMESH_WASM_CLANG)
	set(ELSEMESH_MOVEMENT_WASM "${CMAKE_CURRENT_BINARY_DIR}/elsemesh_movement.wasm")
	add_custom_command(
		OUTPUT "${ELSEMESH_MOVEMENT_WASM}"
		COMMAND "${ELSEMESH_WASM_CLANG}" --target=wasm32-unknown-unknown -O3 -std=c11 -nostdlib
			-I "${CMAKE_CURRENT_SOURCE_DIR}/include"
			-Wl,--no-entry -Wl,--export=em_movement_support_height_batch -Wl,--export-memory
			-Wl,--initial-memory=1048576 -Wl,--max-memory=268435456
			-o "${ELSEMESH_MOVEMENT_WASM}" "${CMAKE_CURRENT_SOURCE_DIR}/src/support.c"
		DEPENDS src/support.c include/elsemesh_movement.h
		VERBATIM)
	add_custom_target(elsemesh_movement_wasm DEPENDS "${ELSEMESH_MOVEMENT_WASM}")
endif()

include(CTest)
if(BUILD_TESTING)
	add_executable(elsemesh_movement_support_smoke tests/support_smoke.c)
	target_link_libraries(elsemesh_movement_support_smoke PRIVATE elsemesh_movement)
	add_test(NAME elsemesh_movement_support_smoke COMMAND elsemesh_movement_support_smoke)
endif()
