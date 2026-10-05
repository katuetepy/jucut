#!/usr/bin/env python3
"""
JuCut Local Engine — Servidor de Alta Performance com FFmpeg Nativo
Executa cortes de vídeo de 500MB - 2GB em poucos segundos usando a CPU/GPU nativa da máquina.
"""

import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
from pathlib import Path
from http.server import ThreadingHTTPServer, HTTPServer, SimpleHTTPRequestHandler
import urllib.parse

# Garantir UTF-8 no console Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = 8765
BASE_DIR = Path(__file__).resolve().parent

# Localizar o executável do FFmpeg
def find_ffmpeg():
    # 1. Checa no próprio diretório do JuCut
    local_ffmpeg = BASE_DIR / "ffmpeg.exe"
    if local_ffmpeg.exists():
        return str(local_ffmpeg)
    
    # 2. Checa no imageio_ffmpeg se instalado
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if os.path.exists(exe):
            return exe
    except Exception:
        pass

    # 3. Checa no PATH do sistema
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    return None

FFMPEG_PATH = find_ffmpeg()

# Estado global de exportação
export_state = {
    "is_busy": False,
    "progress": 0,
    "status": "idle",
    "output_file": None,
    "error": None
}

class JuCutHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        # Cabeçalhos essenciais para SharedArrayBuffer e CORS
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # API: Checar status do motor local
        if parsed.path == "/api/status":
            data = {
                "online": True,
                "ffmpeg_available": FFMPEG_PATH is not None,
                "ffmpeg_path": FFMPEG_PATH,
                "is_busy": export_state["is_busy"],
                "progress": export_state["progress"],
                "status": export_state["status"]
            }
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # API: Progresso da exportação
        if parsed.path == "/api/progress":
            body = json.dumps(export_state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # API: Download do vídeo renderizado
        if parsed.path == "/api/download":
            out_file = export_state.get("output_file")
            if out_file and os.path.exists(out_file):
                filename = os.path.basename(out_file)
                filesize = os.path.getsize(out_file)
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(filesize))
                self.end_headers()
                with open(out_file, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            else:
                self.send_error(404, "Arquivo não encontrado ou exportação pendente")
                return

        # Arquivos estáticos normais
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/export":
            if not FFMPEG_PATH:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "FFmpeg nativo não encontrado no computador"}).encode("utf-8"))
                return

            if export_state["is_busy"]:
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Uma exportação já está em andamento"}).encode("utf-8"))
                return

            try:
                content_type = self.headers.get("Content-Type", "")
                content_length = int(self.headers.get("Content-Length", 0))

                # Ler dados multipart
                boundary = content_type.split("boundary=")[-1].encode()
                raw_body = self.rfile.read(content_length)

                # Processar multipart
                parts = raw_body.split(b"--" + boundary)
                video_data = None
                filename = "video.mp4"
                metadata = {}

                for part in parts:
                    if b"Content-Disposition" in part:
                        headers_part, body_part = part.split(b"\r\n\r\n", 1)
                        body_part = body_part.rstrip(b"\r\n")

                        if b'name="video"' in headers_part:
                            # Extrair nome do arquivo se presente
                            if b'filename="' in headers_part:
                                fn = headers_part.split(b'filename="')[1].split(b'"')[0].decode('utf-8', errors='ignore')
                                if fn:
                                    filename = fn
                            video_data = body_part
                        elif b'name="metadata"' in headers_part:
                            metadata = json.loads(body_part.decode('utf-8'))

                if not video_data:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Nenhum arquivo de vídeo enviado"}).encode("utf-8"))
                    return

                # Iniciar exportação nativa
                export_state["is_busy"] = True
                export_state["progress"] = 5
                export_state["status"] = "Preparando arquivos..."
                export_state["error"] = None

                temp_dir = tempfile.mkdtemp(prefix="jucut_")
                in_ext = Path(filename).suffix or ".mp4"
                input_path = os.path.join(temp_dir, f"input{in_ext}")
                out_format = metadata.get("format", "mp4")
                base_name = Path(filename).stem
                output_path = os.path.join(temp_dir, f"{base_name}_jucut_cortado.{out_format}")

                with open(input_path, "wb") as f:
                    f.write(video_data)

                segments = metadata.get("segments", [])
                speed = float(metadata.get("speed", 1.0))
                mode = metadata.get("mode", "fast")

                export_state["status"] = "Processando com FFmpeg nativo..."
                export_state["progress"] = 25

                # Executar corte via FFmpeg nativo
                success = process_video_ffmpeg(
                    FFMPEG_PATH, input_path, output_path, segments, speed, mode
                )

                if success and os.path.exists(output_path):
                    export_state["progress"] = 100
                    export_state["status"] = "Concluído!"
                    export_state["output_file"] = output_path
                    export_state["is_busy"] = False

                    res_data = {
                        "success": True,
                        "download_url": "/api/download",
                        "filename": os.path.basename(output_path),
                        "size_mb": round(os.path.getsize(output_path) / (1024 * 1024), 2)
                    }
                    body = json.dumps(res_data).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    raise Exception("Falha na execução do FFmpeg")

            except Exception as e:
                export_state["is_busy"] = False
                export_state["error"] = str(e)
                export_state["status"] = f"Erro: {str(e)}"
                err_body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_body)))
                self.end_headers()
                self.wfile.write(err_body)
            return

        self.send_error(404, "Endpoint não encontrado")


def process_video_ffmpeg(ffmpeg_exe, input_file, output_file, segments, speed=1.0, mode="fast"):
    """
    Executa o corte nativo com FFmpeg de forma ultra-rápida.
    """
    if not segments:
        shutil.copyfile(input_file, output_file)
        return True

    temp_dir = os.path.dirname(output_file)
    n = len(segments)

    # 1. Modo Ultra-Rápido (sem re-encoding de vídeo se speed == 1.0)
    # Corta cada pedaço sem re-encode com -c copy e junta com concat demuxer
    if mode == "fast" and abs(speed - 1.0) < 0.01:
        try:
            chunk_files = []
            for i, seg in enumerate(segments):
                start = seg["start"]
                dur = seg["end"] - seg["start"]
                chunk_path = os.path.join(temp_dir, f"part_{i:04d}.mp4")
                cmd = [
                    ffmpeg_exe, "-y",
                    "-ss", f"{start:.4f}",
                    "-i", input_file,
                    "-t", f"{dur:.4f}",
                    "-c", "copy",
                    "-avoid_negative_ts", "make_zero",
                    chunk_path
                ]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                chunk_files.append(chunk_path)

            # Criar arquivo de lista para concat demuxer
            concat_list = os.path.join(temp_dir, "concat.txt")
            with open(concat_list, "w", encoding="utf-8") as f:
                for c in chunk_files:
                    f.write(f"file '{Path(c).name}'\n")

            # Concatenação sem perdas em ~1 segundo!
            concat_cmd = [
                ffmpeg_exe, "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-c", "copy",
                output_file
            ]
            subprocess.run(concat_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return True
        except Exception as e:
            print(f"[Aviso] Modo rápido de stream copy falhou ({e}), usando modo filter_complex...")

    # 2. Modo com Filter Complex (re-encode nativo multi-core ultra-rápido)
    filter_parts = []
    for i, seg in enumerate(segments):
        start = seg["start"]
        end = seg["end"]
        filter_parts.append(f"[0:v]trim=start={start:.4f}:end={end:.4f},setpts=PTS-STARTPTS[v{i}];")
        filter_parts.append(f"[0:a]atrim=start={start:.4f}:end={end:.4f},asetpts=PTS-STARTPTS[a{i}];")

    v_inputs = "".join([f"[v{i}]" for i in range(n)])
    a_inputs = "".join([f"[a{i}]" for i in range(n)])

    if abs(speed - 1.0) > 0.01:
        filter_parts.append(f"{v_inputs}concat=n={n}:v=1:a=0[vconcat];")
        filter_parts.append(f"{a_inputs}concat=n={n}:v=0:a=1[aconcat];")
        filter_parts.append(f"[vconcat]setpts={(1.0/speed):.4f}*PTS[vout];")
        if speed <= 2.0:
            filter_parts.append(f"[aconcat]atempo={speed:.4f}[aout]")
        else:
            filter_parts.append(f"[aconcat]atempo=2.0,atempo={(speed/2.0):.4f}[aout]")
        v_out = "[vout]"
        a_out = "[aout]"
    else:
        filter_parts.append(f"{v_inputs}concat=n={n}:v=1:a=0[vout];")
        filter_parts.append(f"{a_inputs}concat=n={n}:v=0:a=1[aout]")
        v_out = "[vout]"
        a_out = "[aout]"

    filter_complex = "".join(filter_parts)

    cmd = [
        ffmpeg_exe, "-y",
        "-i", input_file,
        "-filter_complex", filter_complex,
        "-map", v_out,
        "-map", a_out,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "128k",
        output_file
    ]

    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def main():
    print("=" * 60)
    print("  🚀 JuCut — Servidor Local de Alta Performance")
    print("=" * 60)
    print(f"  Diretório : {BASE_DIR}")
    print(f"  FFmpeg    : {FFMPEG_PATH or 'NÃO ENCONTRADO'}")
    print(f"  URL Local : http://localhost:{PORT}")
    print("=" * 60)
    print("  Dica: Deixe esta janela aberta enquanto edita vídeos grandes.")
    print("  Pressione Ctrl+C para encerrar.")
    print("-" * 60)

    server = ThreadingHTTPServer(("127.0.0.1", PORT), JuCutHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor JuCut encerrado.")


if __name__ == "__main__":
    main()
