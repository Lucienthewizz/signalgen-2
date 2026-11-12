# LOCAL candidate only. The helper verifies runtime inputs from a pinned local image.
# No RUN, ONBUILD, remote FROM or inherited application binary is permitted.
FROM scratch
COPY runtime/ /etc/
COPY --chown=0:0 --chmod=0555 bin/ /usr/local/bin/
COPY fixtures/ /usr/share/signalgen/fixtures/
COPY licenses/ /usr/share/licenses/signalgen/
USER 10001:10001
ENV PATH=/usr/local/bin HOME=/scratch/home TMPDIR=/scratch/tmp
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=10s --start-period=5s --retries=5 CMD ["signalgen-healthcheck"]
CMD ["signalgen-api"]
