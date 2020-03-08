// Util modules
import * as Enum from './enum.js';

function createAttemptId() {
	const chunks = [];
	const random = new Uint8Array(4);

	for (let x = 0; x < 6; x++) {
		crypto.getRandomValues(random);
		//yay for stack overflow https://stackoverflow.com/a/50767210
		chunks.push(Array.from(random).map((b) => b.toString(16).padStart(2, '0')).join(''));
	}

	return chunks.join('-');
}

export class Signal {
	constructor(onFatal) {
		this.onFatal = onFatal;
		this.attemptId = createAttemptId();
		this.theirCreds = null;
		this.ws = null;
		this.interval = null;
	}

	connect(host, port, sessionId, serverId, creds, onCandidate) {
		this.ws = new WebSocket(`wss://${host}:${port}/?session_id=${sessionId}&role=client&version=1&sdk_version=0`);

		this.ws.onclose = (event) => {
			if (event.code !== 1000)
				this.onFatal(event.code);
		};

		this.ws.onopen = () => {
			this.send({
				action : "offer",
				version : 1,
				payload : {
					to: serverId,
					attempt_id: this.attemptId,
					data: {
						ver_data: 1,
						mode: 2,
						creds,
						versions: {
							p2p: 1,
							bud: 1,
							init: 1,
							video: 1,
							audio: 1,
							control: 1
						}
					}
				}
			});
		};

		this.ready = false;
		this.queuedCandidates = [];
		this.ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);

			switch (msg.action) {
				case 'answer_relay':
					if (!msg.payload.approved)
						this.onFatal(Enum.Warning.Reject);

					this.ready = true;
					this.theirCreds = msg.payload.data.creds;
					for(let candidate of this.queuedCandidates) {
						onCandidate(candidate, this.theirCreds);
					}
					break;

				case 'candex_relay':
					if(this.ready) {
						onCandidate(msg.payload.data, this.theirCreds);
					} else {
						this.queuedCandidates.push(msg.payload.data);
					}
					break;

				case 'error':
					this.onFatal(msg.code);
					break;
			}
		};
	}

	getAttemptId() {
		return this.attemptId;
	}

	send(json) {
		this.ws.send(JSON.stringify(json));
	}

	close(code) {
		if (this.ws) {
			this.ws.close(code);
			this.ws = null;
		}

		clearInterval(this.interval);
		this.interval = null;
	}
}
