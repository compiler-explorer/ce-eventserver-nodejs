import {Mutex} from 'async-mutex';
import net from 'net';

const listenPort = 1337;

const subscriptions: Subscription[] = [];
const subMutex = new Mutex();

type Subscription = {
    socket: net.Socket;
    eventName: string;
};

async function addConnection(socket: net.Socket, eventName: string) {
    await subMutex.acquire();
    try {
        console.log('Adding subscriber for ' + eventName);
        subscriptions.push({
            socket,
            eventName,
        });
    } finally {
        await subMutex.release();
    }

    socket.write('Subscription to ' + eventName + ' confirmed\r\n');
}

async function removeConnection(socket: net.Socket, eventName?: string) {
    await subMutex.acquire();
    try {
        if (eventName) {
            let idx = subscriptions.findIndex((val) => val.socket === socket && val.eventName === eventName);
            while (idx !== -1) {
                const deleted = subscriptions.splice(idx, 1);
                socket.write('Unsubscribed from ' + deleted[0].eventName + '\r\n');

                idx = subscriptions.findIndex((sub) => sub.socket === socket && sub.eventName === eventName);
            }
        } else {
            // note: don't write to the socket here, we're probably already disconnected
            let idx = subscriptions.findIndex((sub) => sub.socket === socket);
            while (idx !== -1) {
                subscriptions.splice(idx, 1);

                idx = subscriptions.findIndex((val) => val.socket === socket);
            }
        }
    } finally {
        await subMutex.release();
    }

    console.log(subscriptions.length + ' subs remaining');
}

async function alertNoParam(eventName: string) {
    await subMutex.acquire();
    try {
        console.log('Alerting for ' + eventName);
        for (const sub of subscriptions) {
            if (sub.eventName === eventName) {
                sub.socket.write('alert: ' + eventName + '\r\n');
            }
        }
    } finally {
        await subMutex.release();
    }
}

async function onClientConnect(socket: net.Socket) {
    socket.on('close', async () => {
        await removeConnection(socket);
    });

    socket.on('data', async (data) => {
        const lines = data.toString().split('\r\n');
        for (const line of lines) {
            if (!line) continue;

            if (line.startsWith('subscribe: ')) {
                await addConnection(socket, line.substr(11));
            } else if (line.startsWith('unsubscribe: ')) {
                await removeConnection(socket, line.substr(13));
            } else if (line.startsWith('alertNoParam: ')) {
                await alertNoParam(line.substr(14));
            } else {
                console.error('Someone said something unknown: ' + line);
            }
        }
    });

    socket.write('Welcome!\r\n' + socket.remoteAddress + ':' + socket.remotePort + '\r\n');
}

const server = net.createServer(onClientConnect);

server.listen(listenPort, '0.0.0.0');
