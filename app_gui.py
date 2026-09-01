#!/usr/bin/env python3
import sys
import os
import signal
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GdkPixbuf, Gdk, GLib

class AashuApp(Gtk.Window):
    def __init__(self, url="http://localhost:3000"):
        super().__init__(title="Aashu AI")
        self.set_default_size(1280, 820)
        self.set_position(Gtk.WindowPosition.CENTER)

        # Force Dark GTK Theme for native headerbar & window frame
        settings = Gtk.Settings.get_default()
        if settings:
            settings.set_property("gtk-application-prefer-dark-theme", True)

        # Sleek Dark Native HeaderBar
        header = Gtk.HeaderBar()
        header.set_show_close_button(True)
        header.set_title("Aashu AI")
        header.set_subtitle("Voice Assistant & Memory")
        self.set_titlebar(header)

        # Custom App Icon
        script_dir = os.path.dirname(os.path.abspath(__file__))
        icon_path = os.path.join(script_dir, "public", "icon.svg")
        if os.path.exists(icon_path):
            try:
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(icon_path, 64, 64, True)
                self.set_icon(pixbuf)
            except Exception:
                pass

        # WebKit Settings for Media / Speech / Web Storage
        context = WebKit2.WebContext.get_default()
        self.webview = WebKit2.WebView.new_with_context(context)
        
        web_settings = self.webview.get_settings()
        web_settings.set_enable_developer_extras(True)
        web_settings.set_enable_media_stream(True)
        web_settings.set_enable_mediasource(True)
        web_settings.set_enable_webrtc(True)
        web_settings.set_enable_javascript(True)
        web_settings.set_enable_html5_local_storage(True)
        web_settings.set_enable_html5_database(True)
        web_settings.set_javascript_can_access_clipboard(True)

        # Custom Dark Background for WebKit window container
        rgba = Gdk.RGBA()
        rgba.parse("#070a12")
        self.webview.set_background_color(rgba)

        # Auto-grant Mic & Media permissions
        self.webview.connect("permission-request", self.on_permission_request)

        self.add(self.webview)
        self.webview.load_uri(url)

        self.connect("destroy", Gtk.main_quit)

    def on_permission_request(self, webview, request):
        # Auto allow microphone and camera access
        request.allow()
        return True

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
    app = AashuApp(url)
    app.show_all()
    Gtk.main()
