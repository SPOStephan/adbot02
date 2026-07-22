import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-900 p-4">
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-5xl font-extrabold mb-6 tracking-tight text-blue-600">
          Multi-Platform Ad Portal
        </h1>
        <p className="text-xl mb-10 text-gray-600 leading-relaxed">
          Verwalte deine Meta, Google und TikTok Ads effizient an einem zentralen Ort.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <div className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition duration-300 cursor-pointer">
            System bereit
          </div>
          <div className="bg-white text-gray-700 border border-gray-200 px-8 py-3 rounded-xl font-bold shadow-sm hover:bg-gray-50 transition duration-300">
            Dokumentation
          </div>
        </div>
        <div className="mt-12 p-4 bg-green-50 border border-green-100 rounded-lg inline-block">
          <span className="text-green-700 font-medium">✓ Infrastruktur erfolgreich verbunden</span>
        </div>
      </div>
    </div>
  );
}
