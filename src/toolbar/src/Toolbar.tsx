import { type ComponentProps, createSignal, onMount, splitProps } from 'solid-js';

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserToolbar {
  navigateBack: () => void;
  navigateForward: () => void;
  refresh: () => void;
  navigateTo: (url: string) => void;
  onLoadingStarted: (callback: () => void) => void;
  onLoadingStopped: (callback: () => void) => void;
  onUrlChanged: (callback: (url: string) => void) => void;
  onNavigationStateChanged: (callback: (state: NavigationState) => void) => void;
}

declare global {
  interface Window {
    ipc: BrowserToolbar;
  }
}

function Button(props: ComponentProps<'button'>) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <button
      {...others}
      class={`size-6 text-lg rounded leading-none hover:bg-kitty-fg/10 disabled:text-kitty-fg/50 disabled:hover:bg-transparent text-kitty-fg ${local.class}`}
    />
  );
}

export function Toolbar() {
  const [isLoading, setIsLoading] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [navigationState, setNavigationState] = createSignal<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });

  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    window.ipc.onLoadingStarted(() => setIsLoading(true));
    window.ipc.onLoadingStopped(() => setIsLoading(false));
    window.ipc.onUrlChanged((newUrl: string) => setUrl(newUrl));
    window.ipc.onNavigationStateChanged((state: NavigationState) => setNavigationState(state));
  });

  const handleUrlSubmit = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      let targetUrl = (e.currentTarget as HTMLInputElement).value.trim();

      // Add https:// if no protocol is specified
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      window.ipc.navigateTo(targetUrl);
    }
  };

  const handleInputClick = (e: MouseEvent) => {
    const input = e.currentTarget as HTMLInputElement;
    if (document.activeElement !== input || input.selectionStart === input.selectionEnd) {
      input.select();
    }
  };

  return (
    <div class="h-screen flex items-center bg-kitty-bg border-b-2 border-active-border text-kitty-fg">
      <div class="flex items-center w-full h-full px-1 box-border">
        <div class="flex gap-1 mx-1">
          <Button
            title="Back"
            disabled={!navigationState().canGoBack}
            onClick={() => window.ipc.navigateBack()}
            class="text-xl pb-[1px]"
          >
            ←
          </Button>
          <Button
            title="Forward"
            disabled={!navigationState().canGoForward}
            onClick={() => window.ipc.navigateForward()}
            class="text-xl pb-[1px]"
          >
            →
          </Button>
          <Button title={isLoading() ? 'Stop' : 'Refresh'} onClick={() => window.ipc.refresh()}>
            {isLoading() ? '✕' : '↻'}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder="Enter URL"
          value={url()}
          spellcheck="false"
          onClick={handleInputClick}
          onKeyDown={handleUrlSubmit}
          class={`flex-1 h-6 px-1 text-sm border rounded-xs border-active-border selection:bg-selection-background selection:text-selection-foreground ${isLoading()
              ? 'bg-kitty-fg/10 border-inactive-border/50 text-kitty-fg/50'
              : 'bg-kitty-fg/10'
            }`}
        />
      </div>
    </div>
  );
}
