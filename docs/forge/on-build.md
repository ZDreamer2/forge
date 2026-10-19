# Forge application verification

Run the aggregate `check`, build, and `test:workspace` commands from the repository
root with the pinned Node runtime. Consumer tests exercise the actual tarball;
source imports or a symlink are not packaging evidence. Use the optional module
argument to verify a consuming workspace's policy without embedding private
workspace rules into this public-source candidate.
