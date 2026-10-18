export namespace main {
	
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

