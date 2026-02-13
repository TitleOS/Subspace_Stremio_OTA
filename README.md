# Subspace

A Stremio addon that imports your local OTA (Over-the-Air) channels from an **HDHomeRun Connect 4K** tuner directly into the Stremio interface.

![Version](https://img.shields.io/badge/version-1.1.1-blue) ![Docker](https://img.shields.io/badge/docker-automated-green) ![Stremio Addon](https://img.shields.io/badge/stremio-purple)
![Status](https://img.shields.io/badge/access-private_beta-red)

## 📺 Features

* **Live TV Catalog:** Adds a "HDHomerun" row to your Stremio Board.
* **Smart EPG:** Automatically fetches "Now Playing" data using your HDHomeRun's native cloud guide (no extra config/ZIP needed).
* **Dynamic Logos:** Fetches channel logos from GitHub, falls back to generated Avatars, and finally to a local retro-style icon.
* **Tech Specs Dashboard:** View real-time signal strength, quality, and codec info directly in the stream list.
* **Transcoding Support:** Routes streams through a [Mediaflow Proxy](https://github.com/mhadzic/mediaflow-proxy) to handle ATSC 3.0 (AC-4 audio).

## 🚀 Installation

### Option 1: Docker Compose (Recommended)

```yaml
services:
  hdhomerun-stremio:
    image: titleos/hdhomerun-stremio:latest
    container_name: hdhomerun-stremio
    restart: always
    environment:
      - HDHOMERUN_IP=192.168.1.100       # Your HDHomeRun LAN IP
      - MEDIAFLOW_URL=http://192.168.1.50:8888  # Your Mediaflow Proxy URL
      - MEDIAFLOW_PASS=your_password     # Your Mediaflow API Password
      - EXTERNAL_URL=http://stremioota.lan # URL to reach this addon
      - DEBUG_LOGGING=false              # Set to 'true' for verbose logs
    ports:
      - "7000:7000"

```

### Option 2: Docker CLI

```bash
docker run -d \
  --name=hdhomerun-stremio \
  --restart=always \
  -e HDHOMERUN_IP=192.168.1.100 \
  -e MEDIAFLOW_URL=[http://192.168.1.50:8888](http://192.168.1.50:8888) \
  -e MEDIAFLOW_PASS=your_password \
  -e EXTERNAL_URL=http://stremioota.lan \
  -p 7000:7000 \
  titleos/hdhomerun-stremio:latest

```

## ⚙️ Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `HDHOMERUN_IP` | The local IP address of your HDHomeRun tuner. | `192.168.1.100` |
| `EXTERNAL_URL` | The URL used to reach this addon (used for logo proxying). | `http://stremioota.lan` |
| `MEDIAFLOW_URL` | The full URL to your Mediaflow Proxy instance. | `http://localhost:8888` |
| `MEDIAFLOW_PASS` | The API password configured in Mediaflow. | `(Empty)` |
| `DEBUG_LOGGING` | Enable request logging for troubleshooting. | `false` |

## 🔌 Connecting to Stremio

1. Ensure the container is running and accessible.
2. Open Stremio on your device.
3. In the search bar (or Addon URL field), enter:
```
http://YOUR_SERVER_IP:7000/manifest.json

```
4. Click **Install**.

## Public Instance (Private Beta) 
I'm currently hosting a public instance in private beta that is fed Minneapolis-St Paul OTA channels via my HDHomeRun Connect 4k. To prevent restreaming and limit bandwidth, an API Key is required for the beta at this time. Email titleos@titleos.dev if interested with the subject line "Subspace Addon Private Beta". Rate limiting for streams is applied and will be adjusted as needed. 

## 📝 License

MPL-2.0 - Created by **TitleOS**
