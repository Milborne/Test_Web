cmake_minimum_required(VERSION 3.16)
project(sdl_demo LANGUAGES CXX)

add_executable(index src/main.cpp)
set_target_properties(index PROPERTIES SUFFIX ".html" RUNTIME_OUTPUT_DIRECTORY "/out")
target_compile_features(index PRIVATE cxx_std_17)
target_link_options(index PRIVATE
  "-sUSE_SDL=2"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sNO_EXIT_RUNTIME=1"
  "--shell-file=${CMAKE_SOURCE_DIR}/shell.html"
)
