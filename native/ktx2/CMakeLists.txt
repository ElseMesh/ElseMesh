cmake_minimum_required(VERSION 3.20)
project(elsemesh_ktx2 LANGUAGES CXX)

set(BASISU_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/basis_universal"
    CACHE PATH "Basis Universal source checkout")
if(NOT EXISTS "${BASISU_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "Basis Universal source not found: ${BASISU_SOURCE_DIR}")
endif()

set(BASISU_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BASISU_BUILD_PYTHON OFF CACHE BOOL "" FORCE)
set(BASISU_OPENCL OFF CACHE BOOL "" FORCE)
set(BASISU_SUPPORT_ASTCENC OFF CACHE BOOL "" FORCE)
set(BASISU_ZSTD OFF CACHE BOOL "" FORCE)
add_subdirectory("${BASISU_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/basis_universal" EXCLUDE_FROM_ALL)
set_property(TARGET basisu_encoder PROPERTY POSITION_INDEPENDENT_CODE ON)

add_library(elsemesh_ktx2 SHARED src/encoder.cpp)
target_compile_features(elsemesh_ktx2 PRIVATE cxx_std_17)
target_include_directories(elsemesh_ktx2
    PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include"
    PRIVATE "${BASISU_SOURCE_DIR}/encoder")
target_link_libraries(elsemesh_ktx2 PRIVATE basisu_encoder)
if(UNIX)
    target_link_libraries(elsemesh_ktx2 PRIVATE m pthread)
endif()
set_target_properties(elsemesh_ktx2 PROPERTIES OUTPUT_NAME elsemesh_ktx2)

include(CTest)
if(BUILD_TESTING)
    add_executable(elsemesh_ktx2_smoke tests/encode_smoke.cpp)
    target_link_libraries(elsemesh_ktx2_smoke PRIVATE elsemesh_ktx2)
    add_test(NAME elsemesh_ktx2_smoke COMMAND elsemesh_ktx2_smoke)
endif()
