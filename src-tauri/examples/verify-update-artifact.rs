//! Read-only release regression helper using the application's actual verifier.
#[allow(dead_code)]
#[path = "../src/update_trust.rs"]
mod update_trust;

fn verify() -> Result<(), String> {
    let args = std::env::args_os().collect::<Vec<_>>();
    if args.len() != 4 {
        return Err("usage: verify-update-artifact <artifact> <signature> <public-key>".into());
    }
    let payload = std::fs::read(&args[1]).map_err(|error| error.to_string())?;
    let signature = std::fs::read_to_string(&args[2]).map_err(|error| error.to_string())?;
    let public_key = std::fs::read_to_string(&args[3]).map_err(|error| error.to_string())?;
    update_trust::verify_minisign(&payload, &signature, &public_key)
        .map_err(|error| error.to_string())
}

fn main() {
    if let Err(error) = verify() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
