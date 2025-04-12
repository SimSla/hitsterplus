import {Component, useEffect, useState} from 'react'
import {Scanner} from '@yudiel/react-qr-scanner';
import {SpotifyApi} from '@spotify/web-api-ts-sdk';
import hitsterBanner from './assets/hitster-banner.png'
import gamesetDatabaseJson from './assets/gameset_database.json';
import countriesJson from './assets/countries.json';
import {KeepAwake} from 'react-keep-awake'

import './App.css'
import {IDetectedBarcode} from "@yudiel/react-qr-scanner/dist/types";
import {HitsterGamesetDatabase} from "./types.tsx";


const enum ViewState {
  Home,
  Scan,
  Listen,
}

const COUNTRIES = countriesJson as Record<string, string>;
const GAMESET_DATABASE = gamesetDatabaseJson as HitsterGamesetDatabase;

interface ViewProps {
  changeViewState: (state: ViewState) => void;
  changeSpotifyUri?: (uri?: string) => void;
  spotifyUri?: string;
  deviceId?: string;
  sdk?: SpotifyApi;
  player?: Spotify.Player;
  playing?: boolean;
}

class HomeView extends Component<ViewProps> {
  render() {
    return <>
      <img src={hitsterBanner} className="banner" alt="Hitster"/>
      <button className="camera-btn round-neon-btn" onClick={() => this.props.changeViewState(ViewState.Scan)}></button>
    </>;
  }
}

class ScannerView extends Component<ViewProps> {
  hitsterPattern = new RegExp(/^www.hitstergame.com\/(?<countryId>[^/]+)(?:\/(?<sku>[^/]*))?\/(?<cardNumber>\d+)$/);

  public async componentDidMount() {
    const accessToken = await this.props.sdk?.getAccessToken();
    if (!accessToken) {
      // We're adding this here so auth flow will occur after the home screen but before any other app interactions.
      console.debug("SDK authentication proc")
      await this.props.sdk?.authenticate();
    }
  }

  getSpotifyUri(countryId: string, cardNumber: string, sku?: string): string | undefined {
    const languageName = COUNTRIES[countryId];
    if (languageName === undefined) {
      alert(`Country ${countryId} not found`);
      return undefined;
    }

    // Get all gamesets for a given language.
    const languageGamesets = GAMESET_DATABASE.gamesets.filter((gameset) => {
      return gameset.gameset_data.gameset_language === languageName
    });

    // Get gameset by SKU, or smallest SKU if none is provided TODO this might be a bad default, need to check a few cards!
    let gameset = undefined;
    if (sku !== undefined) {
      gameset = languageGamesets.find((gameset) => gameset.sku === sku);
    } else {
      gameset = languageGamesets.reduce((gameset1, gameset2) => {
        return gameset1.sku <= gameset2.sku ? gameset1 : gameset2;
      });
    }

    const card = gameset?.gameset_data.cards.find((card) => card.CardNumber === cardNumber);
    if (card !== undefined) {
      return card.Spotify;
    }
    alert(`Could not find card ${cardNumber} in gameset ${sku} for language ${languageName}`);
  }

  onScan = (barcodes: IDetectedBarcode[]) => {
    for (const barcode of barcodes) {
      const match = this.hitsterPattern.exec(barcode.rawValue);
      if (match && match.groups) {
        const uri = this.getSpotifyUri(
          match.groups.countryId,
          match.groups.cardNumber,
          match.groups.sku
        );
        if (this.props.changeSpotifyUri !== undefined) {
          this.props.changeSpotifyUri(uri);
        }
        if (uri !== undefined) {
          this.props.changeViewState(ViewState.Listen);
        }
      }
    }
  }

  render() {
    return <>
      <button className="close-btn" onClick={() => this.props.changeViewState(ViewState.Home)}>
        <span>&times;</span>
      </button>
      <Scanner onScan={this.onScan} classNames={{container: 'qr-container', video: 'qr-video'}}
               allowMultiple={true}/>
      <div className="custom-viewfinder">
        <p className="viewfinder-text">scan your card</p>
      </div>
    </>;
  }
}

class ListenView extends Component<ViewProps> {
  state = {
    progressionPercent: 0,
  }
  private playDurationSeconds: number = 28.5;  // playback <30s shouldn't count towards recommendations
  private startTime: number = 0;
  private endTime: number = 0;
  private canPlay: boolean = false;

  private async startNew(uri: string) {
    const track = await this.props.sdk?.tracks?.get(uri, "BE");  // TODO don't hardcode market

    if (track !== undefined) {
      const duration = track.duration_ms;
      const maxStart = duration - this.playDurationSeconds * 1000;
      this.startTime = Math.floor(Math.random() * maxStart);
      this.endTime = this.startTime + this.playDurationSeconds * 1000;
    }
    if (this.props.player !== undefined && this.props.deviceId !== undefined) {
      const devices = await this.props.sdk?.player.getAvailableDevices();
      console.debug("available devices", devices);
      console.log("current device", this.props.deviceId);
      await this.props.sdk?.player.startResumePlayback(this.props.deviceId, undefined, ["spotify:track:" + uri]);
      await this.props.player?.seek(this.startTime);
      this.canPlay = true;
    }
  }

  private async update() {
    if (this.canPlay && this.props.player !== undefined) {
      const progress = await this.props.player.getCurrentState();
      const position = progress?.position;
      if (position !== undefined) {
        this.setState({progressionPercent: 100 * (position - this.startTime) / (this.endTime - this.startTime)});
        if (position > this.endTime) {
          this.canPlay = false;
          await this.props.player.pause();
        }
      }
    }
  }

  public async componentDidMount() {
    window.setInterval(() => this.update(), 1000);
    if (this.props.spotifyUri !== undefined) {
      await this.startNew(this.props.spotifyUri);
    }
  }

  public async componentDidUpdate(prevProps: ViewProps) {
    if (prevProps.spotifyUri !== this.props.spotifyUri && this.props.spotifyUri !== undefined) {
      await this.startNew(this.props.spotifyUri);
    } else if (this.props.spotifyUri === undefined) {
      await this.props.player?.pause();
    }
  }

  async playPause() {
    if (this.props.playing) {
      await this.props.player?.pause();
    } else if (this.canPlay) {
      await this.props.player?.resume();
    }
  }

  async exitToScan() {
    await this.props.player?.pause();
    if (this.props.changeSpotifyUri !== undefined) {
      this.props.changeSpotifyUri(undefined);
    }
    this.props.changeViewState(ViewState.Scan);
  }

  render() {
    return <>
      <KeepAwake/>
      <button className="close-btn close-btn-dark" onClick={() => this.props.changeViewState(ViewState.Home)}>
        <span>&times;</span>
      </button>
      <button className="play-pause-btn"
              disabled={!this.canPlay}
              onClick={() => this.playPause()}
              style={{'--progress-percent': `${this.state.progressionPercent}%`} as React.CSSProperties}>
        <div className="progress-ring">
          <div className="progress-inner"></div>
        </div>
        <div className={this.props.playing ? "pause-icon" : "play-icon"}></div>
      </button>
      <button className="listen-scan-btn" onClick={() => this.props.playing ? this.playPause() : this.exitToScan()}>
        Scan next card
      </button>
    </>;
  }
}


function App() {
  const [viewState, setViewState] = useState<ViewState>(ViewState.Home);
  const [spotifyUri, setSpotifyUri] = useState<string | undefined>(undefined);
  const [player, setPlayer] = useState<Spotify.Player | undefined>(undefined);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  const [playerInitialised, setPlayerInitialised] = useState(false);
  const [playerActive, setPlayerActive] = useState(false);

  const sdk = SpotifyApi.withUserAuthorization(
    import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    import.meta.env.VITE_REDIRECT_TARGET,
    ["user-read-playback-state", "user-modify-playback-state", "streaming", "user-read-currently-playing", "user-read-email", "user-read-private"]
  );

  // Avoid accumulating connected players on reload.
  window.onbeforeunload = () => {
    player?.disconnect();
  }

  function getView(state: ViewState) {
    switch (state) {
      case ViewState.Scan: {
        return (
          <ScannerView changeViewState={setViewState} changeSpotifyUri={setSpotifyUri} sdk={sdk}/>
        )
      }
      case ViewState.Listen: {
        return (
          <ListenView spotifyUri={spotifyUri} changeViewState={setViewState} changeSpotifyUri={setSpotifyUri} sdk={sdk}
                      deviceId={deviceId} player={player} playing={playing}/>
        )
      }
      default: {
        return (
          <HomeView changeViewState={setViewState}/>
        );
      }
    }
  }

  async function connectToSpotify(reconnect = false) {
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.debug("onSpotifyWebPlaybackSDKReady");
      sdk.authenticate().then(() => {
        sdk.getAccessToken().then(token => {
          console.debug("onSpotifyWebPlaybackSDKReady -> getAccessToken", token);
          if (token !== null) {
            console.debug("Finish player init")
            const player = new window.Spotify.Player({
              name: 'Hitster Player',
              getOAuthToken: cb => {
                cb(token.access_token);
              },
              volume: 1.0
            });

            setPlayer(player);

            player.addListener('ready', ({device_id}) => {
              console.log('Ready with Device ID', device_id);
              setPlayerActive(true);
              setPlayerInitialised(true);
              setDeviceId(device_id);
            });

            player.addListener('not_ready', ({device_id}) => {
              console.log('Device ID has gone offline', device_id);
              setPlayerActive(false);
            });

            player.on('initialization_error', ({message}) => {
              console.error('Failed to initialize', message);
            });
            player.on('authentication_error', ({message}) => {
              console.error('Failed to authenticate', message);
            });
            player.on('account_error', ({message}) => {
              console.error('Failed to validate Spotify account', message);
            });
            player.on('playback_error', ({message}) => {
              console.error('Failed to perform playback', message);
            });

            player.addListener('player_state_changed', (state => {
              console.debug("Player state changed", state);
              if (!state) {
                return;
              }
              setPlaying(!state.paused);
              player.getCurrentState().then((state) => {
                setPlayerActive(!!state);
                console.debug("State pulled.", state);
              });
            }));
            player.connect();
          }
        })
      })
    };

    const prevScript = document.getElementById("spotify-web-player");
    if (prevScript === null || reconnect) {
      prevScript?.remove();
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.id = "spotify-web-player";
      document.body.appendChild(script);
      console.debug("Inserted web-player-sdk script.");
    }
  }

  // On mount.
  useEffect(() => {
    console.debug("Connect on mount.")
    connectToSpotify();
  }, []);  // <-- empty deps, should only run once.


  // Reinitialise when we lose contact.
  useEffect(() => {
    if (playerInitialised && !playerActive) {
      console.debug("Player no longer active, re-initialising.")
      setPlayerInitialised(false);
      player?.disconnect();
      connectToSpotify(true);
    }
  }, [playerInitialised, playerActive]);

  return getView(viewState);
}

export default App
