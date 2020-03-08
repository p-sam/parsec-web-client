function sdpToObj(sdp) {
	const sdpArray = sdp.sdp.split('\n');
	const obj = {};

	for (let x = 0; x < sdpArray.length; x++) {
		const pair = sdpArray[x].split('=');
		const key = pair[0];
		const val = pair[1];

		if (key) {
			if (key === 'a') {
				if (!obj.a) {
					obj.a = {};
				}

				const valPair = val.split(/:(.+)/);
				obj.a[valPair[0]] = valPair[1];
			} else {
				obj[key] = val;
			}
		}
	}

	return obj;
}

function randomSessionId() {
	const random = new Uint8Array(16);
	crypto.getRandomValues(random);

	return random.map((n) => n % 10).join('');
}

function credsToSDPStr(creds, mid) {
	const remoteDesc =
		`v=0\r\n` +
		`o=- ${randomSessionId()} 2 IN IP4 127.0.0.1\r\n` +
		`s=-\r\n` +
		`t=0 0\r\n` +
		`a=group:BUNDLE ${mid}\r\n` +
		`a=msid-semantic: WMS *\r\n` +
		`m=application 9 DTLS/SCTP 5000\r\n` +
		`c=IN IP4 0.0.0.0\r\n` +
		`b=AS:30\r\n` +
		`a=ice-ufrag:${creds.ice_ufrag}\r\n` +
		`a=ice-pwd:${creds.ice_pwd}\r\n` +
		`a=ice-options:trickle\r\n` +
		`a=fingerprint:${creds.fingerprint}\r\n` +
		`a=setup:active\r\n` +
		`a=mid:${mid}\r\n` +
		`a=sendrecv\r\n` +
		`a=sctpmap:5000 webrtc-datachannel 256\r\n` +
		`a=max-message-size:1073741823\r\n`;

	return remoteDesc;
}

function candidateToCandidateStr(candidate, theirCreds) {
	const foundation = 2395300328;
	const priority = 2113937151;
	const type = candidate.from_stun ? 'srflx' : 'host';

	return `candidate:${foundation} 1 udp ${priority} ${candidate.ip} ` +
		`${candidate.port} typ ${type} generation 0 ufrag ${theirCreds.ice_ufrag} network-cost 50`;
}

export class RTC {
	constructor(serverId, attemptId, onCandidate) {
		this.onCandidate = onCandidate;
		this.attemptId = attemptId;
		this.serverId = serverId;
		this.synced = false;
		this.started = false;
		this.sdp = null;
		this.rtc = null;
		this.channels = {};
		this.offer = null;

		this.rtc = new RTCPeerConnection({
			iceServers: [
				{urls: 'stun:stun.parsec.gg:3478'},
			],
		});

		this.rtc.onicecandidate = (event) => {
			if (event.candidate) {
				const carray = event.candidate.candidate.replace('candidate:', '').split(' ');

				if (carray[2].toLowerCase() === 'udp') {
					this.onCandidate(carray[4], parseInt(carray[5], 10), false, "srflx" === carray[7], "host" === carray[7]);
				}
			}
		};

	}

	close() {
		for (const kv of Object.entries(this.channels))
			kv[1].close();

		this.rtc.close();
	}

	addChannel(name, id, onOpen, onMessage) {
		this.channels[id] = this.rtc.createDataChannel(name, {id, negotiated: true});
		this.channels[id].binaryType = 'arraybuffer';
		this.channels[id].onopen = onOpen;
		this.channels[id].onmessage = onMessage;
	}

	async createOffer() {
		this.offer = await this.rtc.createOffer();
		this.sdp = sdpToObj(this.offer);

		//this matches the creds structure from the signal service
		return {
			ice_ufrag: this.sdp.a['ice-ufrag'],
			ice_pwd: this.sdp.a['ice-pwd'],
			fingerprint: this.sdp.a.fingerprint,
		};
	}

	send(buf, id) {
		this.channels[id].send(buf);
	}

	async setCandidate(candidate, theirCreds) {
		if (!this.started) {
			//this will begin STUN
			await this.rtc.setLocalDescription(this.offer);

			const sdpStr = credsToSDPStr(theirCreds, this.sdp.a.mid);
			try {
				await this.rtc.setRemoteDescription({type: 'answer', sdp: sdpStr});
			} catch(e) {
				console.warn(e);
			}

			this.started = true;
		}

		if (!candidate.sync) {
			try {
				await this.rtc.addIceCandidate({
					candidate: candidateToCandidateStr(candidate, theirCreds),
					sdpMid: this.sdp.a.mid,
					sdpMLineIndex: 0,
				});
			} catch(e) {
				console.warn(e);
			}



			if (candidate.from_stun && !this.synced) {
				setTimeout(() => {
					this.onCandidate("1.2.3.4", 1234, true, false, false);
				}, 100);

				this.synced = true;
			}
		}
	}
}
