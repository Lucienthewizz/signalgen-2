// React Bits Carousel adapted to the installed Embla engine; no autoplay or new runtime.
// Video selection stays separate from playback. See LICENSE.md.
import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./WorkspaceControls.css";
type Video = { id: string; title: string };
export default function Carousel({
  items,
  selected,
  onSelect,
}: {
  items: Video[];
  selected: string;
  onSelect: (video: Video) => void;
}) {
  const [viewport, api] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    duration: 22,
  });
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const sync = useCallback(() => {
    setCanPrev(api?.canScrollPrev() ?? false);
    setCanNext(api?.canScrollNext() ?? false);
  }, [api]);
  useEffect(() => {
    if (!api) return;
    sync();
    api.on("select", sync).on("reInit", sync);
    return () => {
      api.off("select", sync).off("reInit", sync);
    };
  }, [api, sync]);
  useEffect(() => {
    if (!api) return;
    const revealSelected = () =>
      api.scrollTo(
        Math.max(
          0,
          items.findIndex((item) => item.id === selected),
        ),
        true,
      );
    revealSelected();
    api.on("reInit", revealSelected);
    return () => {
      api.off("reInit", revealSelected);
    };
  }, [api, selected, items]);
  const move = (direction: number) => {
    const jump = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (direction < 0) api?.scrollPrev(jump);
    else api?.scrollNext(jump);
  };
  return (
    <section
      className="video-carousel"
      aria-label="Market videos"
      aria-roledescription="carousel"
    >
      <div className="video-carousel__heading">
        <span>Choose a video</span>
        <div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous videos"
            disabled={!canPrev}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next videos"
            disabled={!canNext}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="video-carousel__viewport" ref={viewport}>
        <div className="video-carousel__track">
          {items.map((video, index) => (
            <div
              className="video-carousel__slide"
              key={video.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${items.length}`}
            >
              <button
                type="button"
                aria-pressed={selected === video.id}
                onFocus={() => api?.scrollTo(index, true)}
                onClick={() => onSelect(video)}
              >
                <div className="video-carousel__thumbnail">
                  <img
                    src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                    loading="lazy"
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                    draggable={false}
                  />
                  {selected === video.id ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </div>
                <span>{video.title}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
