export namespace main {
	
	export class Playlist {
	    id: string;
	    name: string;
	    trackIds: string[];
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Playlist(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.trackIds = source["trackIds"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class QueueState {
	    sourceId: string;
	    trackIds: string[];
	    index: number;
	
	    static createFrom(source: any = {}) {
	        return new QueueState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceId = source["sourceId"];
	        this.trackIds = source["trackIds"];
	        this.index = source["index"];
	    }
	}
	export class PlaylistsData {
	    playlists: Playlist[];
	    queue: QueueState;
	
	    static createFrom(source: any = {}) {
	        return new PlaylistsData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.playlists = this.convertValues(source["playlists"], Playlist);
	        this.queue = this.convertValues(source["queue"], QueueState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Settings {
	    theme: string;
	    design: string;
	    background: string;
	    palette: string;
	    adaptiveBackground: boolean;
	    neonFrame: boolean;
	    particleCount: number;
	    babbleCount: number;
	    matrixSpeed: number;
	    matrixDensity: number;
	    auroraCount: number;
	    vizPreset: string;
	    vizBars: number;
	    vizSpin: boolean;
	    lastSeenVersion: string;
	    lyricsApiUrl: string;
	    customAccent: string;
	    defaultVolume: number;
	    restoreLastTrack: boolean;
	    dataFolder: string;
	    lastTrackId: string;
	    lastPosition: number;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.design = source["design"];
	        this.background = source["background"];
	        this.palette = source["palette"];
	        this.adaptiveBackground = source["adaptiveBackground"];
	        this.neonFrame = source["neonFrame"];
	        this.particleCount = source["particleCount"];
	        this.babbleCount = source["babbleCount"];
	        this.matrixSpeed = source["matrixSpeed"];
	        this.matrixDensity = source["matrixDensity"];
	        this.auroraCount = source["auroraCount"];
	        this.vizPreset = source["vizPreset"];
	        this.vizBars = source["vizBars"];
	        this.vizSpin = source["vizSpin"];
	        this.lastSeenVersion = source["lastSeenVersion"];
	        this.lyricsApiUrl = source["lyricsApiUrl"];
	        this.customAccent = source["customAccent"];
	        this.defaultVolume = source["defaultVolume"];
	        this.restoreLastTrack = source["restoreLastTrack"];
	        this.dataFolder = source["dataFolder"];
	        this.lastTrackId = source["lastTrackId"];
	        this.lastPosition = source["lastPosition"];
	    }
	}
	export class Track {
	    id: string;
	    title: string;
	    artist?: string;
	    album?: string;
	    path: string;
	    source: string;
	    coverPath?: string;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new Track(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.artist = source["artist"];
	        this.album = source["album"];
	        this.path = source["path"];
	        this.source = source["source"];
	        this.coverPath = source["coverPath"];
	        this.duration = source["duration"];
	    }
	}

}

