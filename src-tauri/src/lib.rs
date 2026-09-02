#[cfg(target_os = "linux")]
fn enable_gtk_dark_theme() {
  std::env::set_var("GTK_THEME", "Adwaita:dark");
  unsafe {
    #[link(name = "gtk-3")]
    extern "C" {
      fn gtk_settings_get_default() -> *mut std::ffi::c_void;
      fn g_object_set(object: *mut std::ffi::c_void, first_property_name: *const std::os::raw::c_char, ...);
    }

    let settings = gtk_settings_get_default();
    if !settings.is_null() {
      let prop_name = std::ffi::CString::new("gtk-application-prefer-dark-theme").unwrap();
      g_object_set(settings, prop_name.as_ptr(), 1i32, std::ptr::null::<std::ffi::c_void>());
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "linux")]
  enable_gtk_dark_theme();

  tauri::Builder::default()
    .setup(|_app| {
      #[cfg(target_os = "linux")]
      enable_gtk_dark_theme();

      if cfg!(debug_assertions) {
        let _ = _app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        );
      }

      // Auto-grant microphone/camera permissions on Linux WebKitGTK
      // Without this, getUserMedia() silently fails — no prompt appears
      #[cfg(target_os = "linux")]
      {
        use tauri::Manager;
        let main_webview = _app.get_webview_window("main").unwrap();
        let _ = main_webview.with_webview(|webview| {
          use webkit2gtk::prelude::*;
          let wv = webview.inner();
          wv.connect_permission_request(|_wv, request| {
            // Auto-allow all media permission requests (microphone, camera)
            request.allow();
            true
          });
        });
      }

      // Auto-spawn Axum backend server in background Tokio task
      tauri::async_runtime::spawn(async {
        if let Err(e) = aashu_backend::start_server().await {
          eprintln!("Error starting Axum backend server inside Tauri: {}", e);
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
