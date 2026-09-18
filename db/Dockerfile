# Postgres 16 + pgvector (semantic knowledge search).
#
# Built on the same postgres:16-alpine image the project has always used, so an existing data
# volume keeps working unchanged. (The ready-made pgvector images are Debian based; pointing them
# at a volume created on Alpine changes the C library's text collation under the existing indexes.)
FROM postgres:16-alpine

ARG PGVECTOR_VERSION=0.8.0

# OPTFLAGS="": no -march=native, so the image also runs on CPUs other than the build machine's.
# with_llvm=no: skip JIT bitcode, which would need a matching clang toolchain for no benefit here.
RUN apk add --no-cache --virtual .build-deps build-base \
 && wget -qO /tmp/pgvector.tar.gz "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" \
 && mkdir /tmp/pgvector && tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1 \
 && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no \
 && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no install \
 && rm -rf /tmp/pgvector /tmp/pgvector.tar.gz \
 && apk del .build-deps
