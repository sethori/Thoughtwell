#!/usr/bin/env bash
# Copies a PostgreSQL 16 install (from the Debian/Ubuntu postgresql-16 package) into
# apps/desktop/resources/pg so the desktop app can ship its own database server.
# The layout under resources/pg mirrors the system one (usr/lib/postgresql/16/bin,
# usr/share/postgresql/16) because Postgres finds its share and lib folders relative
# to its own binary. Shared libraries it needs that are not part of glibc go in resources/pg/lib.
set -euo pipefail
cd "$(dirname "$0")/.."

PGV=16
SRC_LIB="${PG_SRC_LIB:-/usr/lib/postgresql/$PGV}"
SRC_SHARE="${PG_SRC_SHARE:-/usr/share/postgresql/$PGV}"
DEST=resources/pg

[[ -x "$SRC_LIB/bin/postgres" ]] || { echo "PostgreSQL $PGV not found at $SRC_LIB. Install postgresql-$PGV first."; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST/usr/lib/postgresql/$PGV/bin" "$DEST/usr/share/postgresql" "$DEST/lib"
for b in postgres initdb pg_ctl; do cp -a "$SRC_LIB/bin/$b" "$DEST/usr/lib/postgresql/$PGV/bin/"; done
cp -a "$SRC_LIB/lib" "$DEST/usr/lib/postgresql/$PGV/lib"
cp -a "$SRC_SHARE" "$DEST/usr/share/postgresql/$PGV"

# JIT pulls in LLVM (150+ MB) and is useless for a small notes database; the app runs with jit=off.
rm -rf "$DEST/usr/lib/postgresql/$PGV/lib/bitcode" "$DEST/usr/lib/postgresql/$PGV/lib/"llvmjit*

# Only the extensions the app uses, plus what Postgres loads on its own, are needed,
# but keeping the whole lib folder is simplest and still small.
for ext in ltree citext pgcrypto; do
  [[ -f "$DEST/usr/lib/postgresql/$PGV/lib/$ext.so" ]] || { echo "Missing extension library $ext.so"; exit 1; }
  [[ -f "$DEST/usr/share/postgresql/$PGV/extension/$ext.control" ]] || { echo "Missing extension control file $ext.control"; exit 1; }
done

# Bundle shared libraries, skipping the core C library pieces every Linux system has.
SKIP='^(libc|libm|libdl|libpthread|librt|libutil|libresolv|libnsl|libnss_[a-z]+|ld-linux[^ ]*)\.so'
mapfile -t objs < <(find "$DEST/usr/lib" -type f \( -name postgres -o -name initdb -o -name pg_ctl -o -name '*.so' \))
for f in "${objs[@]}"; do
  ldd "$f" 2>/dev/null | awk '/=> \//{print $3}' || true
done | sort -u | while read -r lib; do
  base=$(basename "$lib")
  [[ "$base" =~ $SKIP ]] && continue
  cp -L "$lib" "$DEST/lib/$base"
done

echo "Bundled PostgreSQL $PGV into $DEST ($(du -sh "$DEST" | cut -f1))"
